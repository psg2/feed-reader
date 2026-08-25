import Combine
import FeedReaderCore
import Foundation
import GRDB

/// Where the last notes/tags edit stands: written locally, waiting for the server, or refused by it.
public enum SaveStatus: Equatable, Sendable {
    case saving
    case saved
    /// Written to the mirror; the push is queued behind a network failure.
    case queuedOffline
    /// The server refused the change.
    case failed(String)

    public var text: String {
        switch self {
        case .saving: return "Saving…"
        case .saved: return "Saved"
        case .queuedOffline: return "Saved on this Mac · syncing later"
        case .failed: return "Couldn’t save"
        }
    }

    /// Derives the status from the post's rows still in `pending_ops` (nil rows = nothing queued).
    static func from(pending: [PendingOp], previous: SaveStatus?) -> SaveStatus? {
        if pending.isEmpty { return previous == nil ? nil : .saved }
        if case .failed = previous { return previous }
        return pending.contains { $0.attempts > 0 } ? .queuedOffline : .saving
    }
}

/// One post: content, notes, tags. Notes and tags autosave with a debounce.
@MainActor
public final class ItemDetailModel: ObservableObject {
    public let itemId: Int64

    @Published public private(set) var item: Item?
    @Published public private(set) var feedTitle = ""
    /// True when the feed is configured to always show the web page.
    @Published public private(set) var feedFullPage = false
    /// Per-item override toggled with `w`. nil = follow the feed setting.
    @Published public var fullPageOverride: Bool?

    public var showFullPage: Bool { fullPageOverride ?? feedFullPage }
    public func toggleFullPage() { fullPageOverride = !showFullPage }
    @Published public var notes = "" { didSet { if notes != oldValue { debounce(&notesTask) { [weak self] in self?.saveNotes() } } } }
    @Published public var tagsText = "" { didSet { if tagsText != oldValue { debounce(&tagsTask) { [weak self] in self?.saveTags() } } } }
    /// Feedback for the notes header; nil when nothing was edited or "Saved" has faded.
    @Published public private(set) var saveStatus: SaveStatus?

    private let db: AppDatabase
    /// Queues a change for the server; nil in pure-local mode.
    private let push: ((RemoteOp) -> Void)?
    private var observer: AnyDatabaseCancellable?
    private var queueObserver: AnyDatabaseCancellable?
    private var notesTask: Task<Void, Never>?
    private var tagsTask: Task<Void, Never>?
    private var fadeTask: Task<Void, Never>?
    private var loadedEditable = false
    private let debounceMs: Int

    public init(db: AppDatabase, itemId: Int64, debounceMs: Int = 500, push: ((RemoteOp) -> Void)? = nil) {
        self.db = db
        self.itemId = itemId
        self.debounceMs = debounceMs
        self.push = push
        reload()
    }

    public func reload() {
        let itemId = self.itemId
        observer =
            ValueObservation
            .tracking { @Sendable db -> (Item?, Feed?) in
                let item = try Item.fetchOne(db, id: itemId)
                let feed = try item.flatMap { try Feed.fetchOne(db, id: $0.feedId) }
                return (item, feed)
            }
            .start(in: db.reader, scheduling: .immediate, onError: { _ in }) { [weak self] item, feed in
                guard let self else { return }
                self.item = item
                self.feedTitle = feed?.title ?? ""
                self.feedFullPage = feed?.fullPage ?? false
                if !self.loadedEditable, let item {
                    self.loadedEditable = true
                    self.notes = item.notes ?? ""
                    self.tagsText = (try? self.db.tags(for: itemId))?.joined(separator: ", ") ?? ""
                    if let rid = item.remoteId, self.push != nil { self.observeQueue(remoteId: rid) }
                }
            }
    }

    /// Follows this post's notes/tags ops through `pending_ops`: present → saving (or queued once a push failed), gone → saved.
    private func observeQueue(remoteId: String) {
        let keys = ["setNotes:\(remoteId)", "setTags:\(remoteId)"]
        queueObserver =
            ValueObservation
            .tracking { @Sendable db in try PendingOp.filter(keys.contains(Column("coalesceKey"))).fetchAll(db) }
            .start(in: db.reader, scheduling: .immediate, onError: { _ in }) { [weak self] rows in
                guard let self else { return }
                self.setStatus(SaveStatus.from(pending: rows, previous: self.saveStatus))
            }
    }

    private func setStatus(_ status: SaveStatus?) {
        guard status != saveStatus else { return }
        saveStatus = status
        fadeTask?.cancel()
        guard status == .saved else { return }
        fadeTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            if !Task.isCancelled, self?.saveStatus == .saved { self?.saveStatus = nil }
        }
    }

    /// The queue dropped one of this post's ops (the server refused it).
    func saveFailed(_ reason: String) {
        setStatus(.failed(reason))
    }

    /// "Couldn't save · Retry": write and queue both fields again.
    public func retrySave() {
        setStatus(.saving)
        saveNotes()
        saveTags()
    }

    private func debounce(_ task: inout Task<Void, Never>?, _ work: @escaping () -> Void) {
        guard loadedEditable else { return }
        task?.cancel()
        let ms = debounceMs
        task = Task {
            try? await Task.sleep(for: .milliseconds(ms))
            if !Task.isCancelled { work() }
        }
    }

    public func saveNotes() {
        try? db.setNotes(itemId: itemId, notes: notes)
        if let push, let rid = item?.remoteId {
            if case .failed = saveStatus {} else { setStatus(.saving) }
            push(.setNotes(itemId: rid, notes: notes))
        } else {
            setStatus(.saved)
        }
    }

    public func saveTags() {
        let tags = TagText.parse(tagsText)
        try? db.setTags(itemId: itemId, tags: tags)
        if let push, let rid = item?.remoteId {
            if case .failed = saveStatus {} else { setStatus(.saving) }
            push(.setTags(itemId: rid, tags: tags))
        } else {
            setStatus(.saved)
        }
    }

    /// Flush pending debounced saves (e.g. when the view disappears).
    public func flush() {
        notesTask?.cancel()
        tagsTask?.cancel()
        guard loadedEditable else { return }
        saveNotes()
        saveTags()
    }
}
