import Foundation
import GRDB

public final class AppDatabase: @unchecked Sendable {
    public let writer: any DatabaseWriter
    /// Ops pushed while a pull is in flight; see `beginPull`. Guarded by `pullLock`.
    let pullLock = NSLock()
    var pullsInFlight = 0
    var pushedDuringPull: [(seq: Int, op: RemoteOp)] = []
    var nextPushSeq = 0

    public init(_ writer: any DatabaseWriter) throws {
        self.writer = writer
        try migrator.migrate(writer)
    }

    /// Opens (or creates) the database at ~/Library/Application Support/FeedReader/feedreader.sqlite
    /// Default location, overridable with FEEDREADER_DB (used by tests and by the MCP server config).
    public static func defaultURL() throws -> URL {
        if let p = ProcessInfo.processInfo.environment["FEEDREADER_DB"], !p.isEmpty { return URL(fileURLWithPath: p) }
        let fm = FileManager.default
        let dir = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("FeedReader", isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("feedreader.sqlite")
    }

    /// Opens the mirror at `defaultURL()`. The mirror is disposable (the server has everything), so a file
    /// that cannot be opened or migrated is moved aside as `feedreader.sqlite.corrupt-<timestamp>` and a fresh
    /// one is created; the next pull fills it again.
    public static func open() throws -> AppDatabase {
        let url = try defaultURL()
        do {
            return try open(at: url)
        } catch {
            try moveAside(url)
            return try open(at: url)
        }
    }

    static func open(at url: URL) throws -> AppDatabase {
        var config = Configuration()
        config.foreignKeysEnabled = true
        let pool = try DatabasePool(path: url.path, configuration: config)
        return try AppDatabase(pool)
    }

    /// Renames the database and its WAL/SHM sidecars with a timestamp suffix.
    static func moveAside(_ url: URL) throws {
        let fm = FileManager.default
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        for suffix in ["", "-wal", "-shm"] {
            let from = URL(fileURLWithPath: url.path + suffix)
            guard fm.fileExists(atPath: from.path) else { continue }
            try fm.moveItem(at: from, to: URL(fileURLWithPath: url.path + ".corrupt-\(stamp)" + suffix))
        }
    }

    public static func inMemory() throws -> AppDatabase {
        try AppDatabase(DatabaseQueue())
    }

    public var reader: any DatabaseReader { writer }

    private var migrator: DatabaseMigrator {
        var m = DatabaseMigrator()
        m.registerMigration("v1") { db in
            try db.create(table: "feeds") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("title", .text).notNull()
                t.column("url", .text).notNull().unique()
                t.column("siteURL", .text)
                t.column("category", .text)
                t.column("enabled", .boolean).notNull().defaults(to: true)
                t.column("lastFetchedAt", .datetime)
                t.column("lastError", .text)
                t.column("createdAt", .datetime).notNull()
            }
            try db.create(table: "items") { t in
                t.autoIncrementedPrimaryKey("id")
                t.belongsTo("feed", onDelete: .cascade).notNull()
                t.column("guid", .text).notNull()
                t.column("link", .text)
                t.column("title", .text).notNull()
                t.column("author", .text)
                t.column("publishedAt", .datetime)
                t.column("contentHTML", .text)
                t.column("contentText", .text)
                t.column("readAt", .datetime)
                t.column("starred", .boolean).notNull().defaults(to: false)
                t.column("notes", .text)
                t.column("createdAt", .datetime).notNull()
                t.uniqueKey(["feedId", "guid"])
            }
            try db.create(index: "items_readAt", on: "items", columns: ["readAt"])
            try db.create(index: "items_publishedAt", on: "items", columns: ["publishedAt"])
            try db.create(table: "tags") { t in
                t.belongsTo("item", onDelete: .cascade).notNull()
                t.column("tag", .text).notNull()
                t.primaryKey(["itemId", "tag"])
            }
            try db.create(table: "analyses") { t in
                t.autoIncrementedPrimaryKey("id")
                t.belongsTo("item", onDelete: .cascade).notNull()
                t.column("provider", .text).notNull()
                t.column("promptVersion", .text).notNull()
                t.column("result", .text).notNull()
                t.column("createdAt", .datetime).notNull()
            }
        }
        m.registerMigration("v2-fullPage") { db in
            try db.alter(table: "feeds") { t in
                t.add(column: "fullPage", .boolean).notNull().defaults(to: false)
            }
        }
        m.registerMigration("v3-remote") { db in
            // Server-mirror mode: rows synced from the web API remember their
            // server UUID so local actions can be pushed back (write-through).
            try db.alter(table: "feeds") { t in t.add(column: "remoteId", .text) }
            try db.alter(table: "items") { t in t.add(column: "remoteId", .text) }
            try db.create(index: "feeds_remoteId", on: "feeds", columns: ["remoteId"], unique: true)
            try db.create(index: "items_remoteId", on: "items", columns: ["remoteId"], unique: true)
        }
        m.registerMigration("v4-pendingOps") { db in
            // Offline write queue: local mutations waiting to reach the server (see SyncQueue).
            try db.create(table: "pending_ops") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("kind", .text).notNull()
                t.column("coalesceKey", .text)
                t.column("payload", .text).notNull()
                t.column("createdAt", .datetime).notNull()
                t.column("attempts", .integer).notNull().defaults(to: 0)
                t.column("lastError", .text)
            }
            try db.create(index: "pending_ops_coalesceKey", on: "pending_ops", columns: ["coalesceKey"])
        }
        m.registerMigration("v5-dropAnalyses") { db in
            // Analysis moved to Claude via MCP, which writes notes and tags directly.
            try db.drop(table: "analyses")
        }
        return m
    }
}

// MARK: - Writes

extension AppDatabase {
    @discardableResult
    public func addFeed(_ feed: Feed) throws -> Feed {
        try writer.write { db in
            var f = feed
            try f.insert(db)
            return f
        }
    }

    public func setFullPage(feedId: Int64, _ on: Bool) throws {
        try writer.write { db in
            try db.execute(sql: "UPDATE feeds SET fullPage = ? WHERE id = ?", arguments: [on, feedId])
        }
    }

    /// Pause (`false`) or resume a feed: the server stops fetching it, posts are kept.
    public func setEnabled(feedId: Int64, _ on: Bool) throws {
        try writer.write { db in
            try db.execute(sql: "UPDATE feeds SET enabled = ? WHERE id = ?", arguments: [on, feedId])
        }
    }

    public func deleteFeed(id: Int64) throws {
        _ = try writer.write { db in try Feed.deleteOne(db, id: id) }
    }

    public func markRead(itemId: Int64, read: Bool) throws {
        try writer.write { db in
            try db.execute(sql: "UPDATE items SET readAt = ? WHERE id = ?", arguments: [read ? Date() : nil, itemId])
        }
    }

    /// Marks every unread item (optionally within one feed) as read and returns the affected ids, so callers can undo precisely.
    @discardableResult
    public func markAllRead(feedId: Int64?) throws -> [Int64] {
        try writer.write { db in
            let ids: [Int64]
            if let feedId {
                ids = try Int64.fetchAll(db, sql: "SELECT id FROM items WHERE readAt IS NULL AND feedId = ?", arguments: [feedId])
            } else {
                ids = try Int64.fetchAll(db, sql: "SELECT id FROM items WHERE readAt IS NULL")
            }
            try Self.setRead(db, ids: ids, read: true)
            return ids
        }
    }

    public func markRead(itemIds: [Int64], read: Bool) throws {
        try writer.write { db in try Self.setRead(db, ids: itemIds, read: read) }
    }

    private static func setRead(_ db: Database, ids: [Int64], read: Bool) throws {
        guard !ids.isEmpty else { return }
        let now = Date()
        for chunk in stride(from: 0, to: ids.count, by: 500).map({ Array(ids[$0..<min($0 + 500, ids.count)]) }) {
            let marks = Array(repeating: "?", count: chunk.count).joined(separator: ",")
            try db.execute(
                sql: "UPDATE items SET readAt = ? WHERE id IN (\(marks))",
                arguments: StatementArguments([read ? now : nil] + chunk.map { $0 as DatabaseValueConvertible? }))
        }
    }

    public func setStarred(itemId: Int64, starred: Bool) throws {
        try writer.write { db in
            try db.execute(sql: "UPDATE items SET starred = ? WHERE id = ?", arguments: [starred, itemId])
        }
    }

    public func setNotes(itemId: Int64, notes: String) throws {
        try writer.write { db in
            try db.execute(sql: "UPDATE items SET notes = ? WHERE id = ?", arguments: [notes.isEmpty ? nil : notes, itemId])
        }
    }

    public func setTags(itemId: Int64, tags: [String]) throws {
        let clean = Set(tags.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty })
        try writer.write { db in
            try Tag.filter(Column("itemId") == itemId).deleteAll(db)
            for t in clean { try Tag(itemId: itemId, tag: t).insert(db) }
        }
    }
}

// MARK: - Reads

public enum ItemFilter: Hashable, Sendable {
    case all
    case unread
    case starred
    case feed(Int64)
    case tag(String)
}

extension AppDatabase {
    /// Quick search across all posts, for the command palette.
    public func searchItems(_ query: String, limit: Int = 8) throws -> [ItemRow] {
        try reader.read { db in try Self.itemsRequest(filter: .all, search: query).limit(limit).fetchAll(db) }
    }

    public static func itemsRequest(filter: ItemFilter, search: String = "") -> QueryInterfaceRequest<ItemRow> {
        var req =
            Item
            .annotated(withRequired: Item.feed.select(Column("title").forKey("feedTitle")))
            .order(Column("publishedAt").desc, Column("id").desc)
        switch filter {
        case .all: break
        case .unread: req = req.filter(Column("readAt") == nil)
        case .starred: req = req.filter(Column("starred") == true)
        case .feed(let id): req = req.filter(Column("feedId") == id)
        case .tag(let tag):
            req = req.filter(sql: "items.id IN (SELECT itemId FROM tags WHERE tag = ?)", arguments: [tag])
        }
        let q = search.trimmingCharacters(in: .whitespaces)
        if !q.isEmpty {
            let like = "%\(q)%"
            req = req.filter(sql: "(items.title LIKE ? OR items.contentText LIKE ? OR items.notes LIKE ?)", arguments: [like, like, like])
        }
        return req.asRequest(of: ItemRow.self)
    }

    /// Drops every mirrored row and the pending write queue (sign out). Feeds cascade to items and tags.
    public func wipe() throws {
        try writer.write { db in
            _ = try Feed.deleteAll(db)
            _ = try PendingOp.deleteAll(db)
        }
    }

    public func enabledFeeds() throws -> [Feed] {
        try reader.read { db in try Feed.filter(Column("enabled") == true).order(Column("title")).fetchAll(db) }
    }

    /// How many posts a feed holds, and how many of them carry notes. Shown before unsubscribing.
    public func feedCounts(feedId: Int64) throws -> (posts: Int, withNotes: Int) {
        try reader.read { db in
            let posts = try Item.filter(Column("feedId") == feedId).fetchCount(db)
            let notes = try Item.filter(Column("feedId") == feedId && Column("notes") != nil).fetchCount(db)
            return (posts, notes)
        }
    }

    public func feed(id: Int64) throws -> Feed? {
        try reader.read { db in try Feed.fetchOne(db, id: id) }
    }

    public func item(id: Int64) throws -> Item? {
        try reader.read { db in try Item.fetchOne(db, id: id) }
    }

    public func tags(for itemId: Int64) throws -> [String] {
        try reader.read { db in
            try String.fetchAll(db, sql: "SELECT tag FROM tags WHERE itemId = ? ORDER BY tag", arguments: [itemId])
        }
    }

    public func allTags() throws -> [String] {
        try reader.read { db in
            try String.fetchAll(db, sql: "SELECT DISTINCT tag FROM tags ORDER BY tag")
        }
    }
}

public struct FeedWithCounts: Identifiable, Hashable, FetchableRecord {
    public var feed: Feed
    public var unreadCount: Int
    public var id: Int64 { feed.id ?? 0 }

    public init(row: Row) throws {
        feed = try Feed(row: row)
        unreadCount = row["unreadCount"]
    }
}

extension AppDatabase {
    public static func feedsWithCountsRequest() -> SQLRequest<FeedWithCounts> {
        SQLRequest(
            sql: """
                SELECT feeds.*, (SELECT COUNT(*) FROM items WHERE items.feedId = feeds.id AND items.readAt IS NULL) AS unreadCount
                FROM feeds ORDER BY feeds.title COLLATE NOCASE
                """)
    }
}
