import Foundation
import GRDB

/// One local mutation waiting to be pushed to the server, addressed by server ids.
///
/// Stored as JSON in `pending_ops` so it survives restarts. `replay` re-applies
/// the same change to the mirror after a pull, so the server's stale state never
/// hides a write that has not reached it yet.
public enum RemoteOp: Codable, Equatable, Sendable {
    case markRead(itemIds: [String], read: Bool)
    case setStarred(itemId: String, starred: Bool)
    case setNotes(itemId: String, notes: String)
    case setTags(itemId: String, tags: [String])
    case setFullPage(feedId: String, fullPage: Bool)
    case setEnabled(feedId: String, enabled: Bool)
    case removeFeed(feedId: String)

    /// Short name stored next to the payload, for inspection and coalescing.
    public var kind: String {
        switch self {
        case .markRead: return "markRead"
        case .setStarred: return "setStarred"
        case .setNotes: return "setNotes"
        case .setTags: return "setTags"
        case .setFullPage: return "setFullPage"
        case .setEnabled: return "setEnabled"
        case .removeFeed: return "removeFeed"
        }
    }

    /// Ops with the same key supersede each other: only the latest value matters.
    /// Bulk read marks are never coalesced.
    public var coalesceKey: String? {
        switch self {
        case .markRead(let ids, _): return ids.count == 1 ? "markRead:\(ids[0])" : nil
        case .setStarred(let id, _): return "setStarred:\(id)"
        case .setNotes(let id, _): return "setNotes:\(id)"
        case .setTags(let id, _): return "setTags:\(id)"
        case .setFullPage(let id, _): return "setFullPage:\(id)"
        case .setEnabled(let id, _): return "setEnabled:\(id)"
        case .removeFeed(let id): return "removeFeed:\(id)"
        }
    }

    /// Performs the corresponding remote call.
    public func push(to api: RemoteAPI) async throws {
        switch self {
        case .markRead(let ids, let read): try await api.markRead(remoteIds: ids, read: read)
        case .setStarred(let id, let starred): try await api.updateItem(remoteId: id, starred: starred)
        case .setNotes(let id, let notes): try await api.updateItem(remoteId: id, notes: notes)
        case .setTags(let id, let tags): try await api.updateItem(remoteId: id, tags: tags)
        case .setFullPage(let id, let on): try await api.updateFeed(remoteId: id, fullPage: on)
        case .setEnabled(let id, let on): try await api.updateFeed(remoteId: id, enabled: on)
        case .removeFeed(let id): try await api.removeFeed(remoteId: id)
        }
    }

    /// Re-applies the change to mirrored rows (matched by `remoteId`). Missing rows are skipped.
    public func replay(in db: Database) throws {
        switch self {
        case .markRead(let ids, let read):
            let now = Date()
            for chunk in stride(from: 0, to: ids.count, by: 500).map({ Array(ids[$0..<min($0 + 500, ids.count)]) }) {
                try Item.filter(chunk.contains(Column("remoteId"))).updateAll(db, Column("readAt").set(to: read ? now : nil))
            }
        case .setStarred(let id, let starred):
            try Item.filter(Column("remoteId") == id).updateAll(db, Column("starred").set(to: starred))
        case .setNotes(let id, let notes):
            try Item.filter(Column("remoteId") == id).updateAll(db, Column("notes").set(to: notes.isEmpty ? nil : notes))
        case .setTags(let id, let tags):
            guard let itemId = try Item.filter(Column("remoteId") == id).fetchOne(db)?.id else { return }
            try Tag.filter(Column("itemId") == itemId).deleteAll(db)
            for tag in Set(tags) { try Tag(itemId: itemId, tag: tag).insert(db) }
        case .setFullPage(let id, let on):
            try Feed.filter(Column("remoteId") == id).updateAll(db, Column("fullPage").set(to: on))
        case .setEnabled(let id, let on):
            try Feed.filter(Column("remoteId") == id).updateAll(db, Column("enabled").set(to: on))
        case .removeFeed(let id):
            try Feed.filter(Column("remoteId") == id).deleteAll(db)
        }
    }
}

/// A row of `pending_ops`: a `RemoteOp` plus its retry bookkeeping.
public struct PendingOp: Codable, Identifiable, Equatable, FetchableRecord, MutablePersistableRecord, Sendable {
    public static let databaseTableName = "pending_ops"

    public var id: Int64?
    public var kind: String
    public var coalesceKey: String?
    public var payload: String
    public var createdAt: Date
    public var attempts: Int
    public var lastError: String?

    public init(op: RemoteOp, createdAt: Date = Date()) throws {
        self.kind = op.kind
        self.coalesceKey = op.coalesceKey
        self.payload = String(decoding: try JSONEncoder().encode(op), as: UTF8.self)
        self.createdAt = createdAt
        self.attempts = 0
    }

    public var op: RemoteOp? {
        try? JSONDecoder().decode(RemoteOp.self, from: Data(payload.utf8))
    }

    public mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}

// MARK: - Storage

extension AppDatabase {
    /// Appends `op`, replacing any queued op with the same coalesce key.
    public func enqueue(_ op: RemoteOp) throws {
        try writer.write { db in
            if let key = op.coalesceKey {
                try PendingOp.filter(Column("coalesceKey") == key).deleteAll(db)
            }
            var row = try PendingOp(op: op)
            try row.insert(db)
        }
    }

    /// Queued ops, oldest first.
    public func pendingOps() throws -> [PendingOp] {
        try reader.read { db in try PendingOp.order(Column("id")).fetchAll(db) }
    }

    public func pendingOpCount() throws -> Int {
        try reader.read { db in try PendingOp.fetchCount(db) }
    }

    public func deletePendingOp(id: Int64) throws {
        _ = try writer.write { db in try PendingOp.deleteOne(db, id: id) }
    }

    public func recordPendingOpFailure(id: Int64, error: String) throws {
        try writer.write { db in
            try db.execute(
                sql: "UPDATE pending_ops SET attempts = attempts + 1, lastError = ? WHERE id = ?", arguments: [error, id])
        }
    }

    public func clearPendingOps() throws {
        _ = try writer.write { db in try PendingOp.deleteAll(db) }
    }

    /// Re-applies every queued op to the mirror, in order. Called after a pull.
    public func replayPendingOps() throws {
        try writer.write { db in try Self.replayPending(in: db) }
    }

    private static func replayPending(in db: Database) throws {
        for row in try PendingOp.order(Column("id")).fetchAll(db) {
            try row.op?.replay(in: db)
        }
    }

    // MARK: Pull bookkeeping

    /// Marks the start of a pull. Ops the server accepts from now until `finishPull` are remembered so the pull
    /// can replay them: the server's dump was taken before they arrived, so applying it alone would revert them
    /// locally until the next pull. Returns a marker for `finishPull`/`endPull`.
    public func beginPull() -> Int {
        pullLock.withLock {
            pullsInFlight += 1
            return nextPushSeq
        }
    }

    /// Ends a pull that did not get to apply anything.
    public func endPull(since marker: Int) {
        _ = takePushed(since: marker)
    }

    /// Ends a pull after its dump was applied: replays the ops pushed since `beginPull` and then every op still
    /// queued, all in one write. The drain notes a push before it deletes the row (see `SyncQueue`), so an op
    /// is always seen by one of the two lists, whichever side of this transaction its delete lands on.
    public func finishPull(since marker: Int) throws {
        try writer.write { db in
            for op in takePushed(since: marker) { try op.replay(in: db) }
            try Self.replayPending(in: db)
        }
    }

    /// Ops pushed since `marker`, oldest first; closes the pull.
    func takePushed(since marker: Int) -> [RemoteOp] {
        pullLock.withLock {
            pullsInFlight -= 1
            let ops = pushedDuringPull.filter { $0.seq >= marker }.map(\.op)
            if pullsInFlight == 0 { pushedDuringPull.removeAll() }
            return ops
        }
    }

    /// Records an op the server accepted, if a pull is in flight.
    public func notePushed(_ op: RemoteOp) {
        pullLock.withLock {
            guard pullsInFlight > 0 else { return }
            pushedDuringPull.append((nextPushSeq, op))
            nextPushSeq += 1
        }
    }
}

// MARK: - Draining

/// Pushes queued ops to the server one at a time, oldest first.
///
/// A transient failure (no network, 5xx, 401/408/429) leaves the op queued with
/// `attempts` bumped and stops the drain so order is preserved. A definitive 4xx
/// drops the op and reports it. `OAuthError.signedOut` stops the drain and is
/// rethrown for the caller to route to the sign-in screen.
public actor SyncQueue {
    public struct Outcome: Equatable, Sendable {
        /// Ops the server accepted.
        public var pushed = 0
        /// Ops the server rejected for good, with their errors.
        public var dropped: [(RemoteOp, String)] = []
        /// The transient error that stopped the drain, if any.
        public var stalledOn: String?
        /// `attempts` of the op that stalled, for backoff.
        public var attempts = 0

        public var remaining: Bool { stalledOn != nil }

        public static func == (lhs: Outcome, rhs: Outcome) -> Bool {
            lhs.pushed == rhs.pushed && lhs.stalledOn == rhs.stalledOn && lhs.attempts == rhs.attempts
                && lhs.dropped.map(\.0) == rhs.dropped.map(\.0) && lhs.dropped.map(\.1) == rhs.dropped.map(\.1)
        }
    }

    private let db: AppDatabase
    private var current: Task<Outcome, Error>?

    public init(db: AppDatabase) {
        self.db = db
    }

    /// Drains the queue. Concurrent callers share the drain already in flight.
    public func drain(api: RemoteAPI) async throws -> Outcome {
        if let current { return try await current.value }
        let task = Task { try await run(api: api) }
        current = task
        defer { current = nil }
        return try await task.value
    }

    private func run(api: RemoteAPI) async throws -> Outcome {
        var outcome = Outcome()
        for row in try db.pendingOps() {
            guard let id = row.id else { continue }
            guard let op = row.op else {
                try db.deletePendingOp(id: id)
                continue
            }
            do {
                try await op.push(to: api)
                db.notePushed(op)  // before the delete, so a concurrent pull sees the op in one list or the other
                try db.deletePendingOp(id: id)
                outcome.pushed += 1
            } catch OAuthError.signedOut {
                throw OAuthError.signedOut
            } catch {
                let message = error.localizedDescription
                if Self.isDefinitive(error) || (row.attempts + 1 >= Self.maxAttempts && !Self.isOffline(error)) {
                    try db.deletePendingOp(id: id)
                    outcome.dropped.append((op, message))
                } else {
                    try db.recordPendingOpFailure(id: id, error: message)
                    outcome.stalledOn = message
                    outcome.attempts = row.attempts + 1
                    break
                }
            }
        }
        return outcome
    }

    /// A transient failure that keeps coming back (5xx, 429, an unexpected error) gives up after this many
    /// attempts, so one op cannot block the queue for good. Being offline does not count: those ops wait for the
    /// network however long it takes.
    static let maxAttempts = 8

    /// True for answers that will not change on retry: 4xx (except 401/408/429) and responses the client
    /// cannot decode, which mean the op and the server disagree on the contract.
    static func isDefinitive(_ error: Error) -> Bool {
        let status: Int
        switch error {
        case RemoteError.http(let s, _): status = s
        case RemoteError.api(let s, _, _): status = s
        case RemoteError.decoding: return true
        default: return false
        }
        return (400..<500).contains(status) && ![401, 408, 429].contains(status)
    }

    /// True when the request never reached the server.
    static func isOffline(_ error: Error) -> Bool {
        error is URLError
    }
}
