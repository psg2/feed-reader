import AppKit
import Combine
import FeedReaderCore
import Foundation

/// Process-wide state: the server session, the local mirror, the sync timer
/// and navigation. Column-specific state lives in the models.
///
/// The server is the source of truth. Reads come from the SQLite mirror (GRDB
/// observation untouched); every local mutation is written to SQLite, queued
/// in `pending_ops` and pushed by `SyncQueue`, and "refresh" means "server
/// refresh, then pull".
@MainActor
public final class AppState: ObservableObject {
    public static let defaultServerURL = URL(string: "https://reader.sereno.dev.br")!
    /// `defaults write dev.sereno.feedreader remoteServerURL https://feedreader.localhost` for local development.
    static let serverURLKey = "remoteServerURL"

    public let db: AppDatabase
    /// The server this app talks to. Changed only while signed out, via `configureServer`.
    @Published public internal(set) var serverURL: URL
    public internal(set) var oauth: OAuthClient
    public internal(set) var tokens: TokenProvider
    public internal(set) var remoteAPI: RemoteAPI
    let queue: SyncQueue

    @Published public var isSignedIn: Bool
    @Published public var isSigningIn = false
    @Published public var signInError: String?
    @Published public var profile: Profile? {
        didSet {
            if let profile, let data = try? JSONEncoder().encode(profile) {
                defaults.set(data, forKey: "profile")
            } else {
                defaults.removeObject(forKey: "profile")
            }
        }
    }

    @Published public var isRefreshing = false
    @Published public var lastSync: Date?
    /// Immediate failures of something the user just asked for (add feed, import); shown as an alert.
    @Published public var errorMessage: String?
    /// The last background failure (pull, push, refresh); shown in the footer until the next success.
    @Published public internal(set) var syncError: String?
    /// True after a failed pull/refresh, so the footer's Retry pulls again (a failed push only needs a drain).
    var pullFailed = false
    /// Local changes still waiting to reach the server.
    @Published public internal(set) var pendingCount = 0

    @Published public var filter: ItemFilter = .unread
    @Published public var search: String = ""
    @Published public var selectedItemId: Int64?

    /// Bumped after every pull and when the app becomes active so models re-query.
    @Published public var reloadToken = 0

    /// Clock used for relative times in views; tests pin it.
    public var now: () -> Date = { Date() }

    /// The detail model currently on screen, for keyboard actions that target the open post.
    public weak var activeDetail: ItemDetailModel?

    public let keys = KeyRouter()
    public internal(set) var actions: [AppAction] = []

    // UI requests driven by actions (keyboard, palette, menu).
    @Published public var focusRequest: (FocusTarget, Int) = (.list, 0)
    @Published public var showAddFeed = false
    @Published public var showShortcuts = false
    @Published public var showPalette = false
    @Published public var hintDismissed: Bool {
        didSet { defaults.set(hintDismissed, forKey: "hintDismissed") }
    }

    /// App-level undo for read/star/mark-all actions. Separate from text editing undo.
    public let undoManager = UndoManager()
    @Published public var toast: Toast?
    var toastTask: Task<Void, Never>?

    /// Minutes between automatic pulls from the server. Persisted in UserDefaults.
    @Published public var refreshIntervalMinutes: Int {
        didSet {
            defaults.set(refreshIntervalMinutes, forKey: "refreshIntervalMinutes")
            scheduleTimer()
        }
    }

    let defaults: UserDefaults
    let session: URLSession
    /// Builds the token store for a server host; the app keeps one session file per host.
    let tokenStoreForHost: (String) -> TokenStore
    var pendingSignIn: OAuthClient.PKCE?
    var retryTask: Task<Void, Never>?
    private var timer: Timer?
    private var activationObserver: NSObjectProtocol?

    /// The app passes `FileTokenStore.standard(host:)` as `tokenStoreForHost`, so switching
    /// servers switches session files; tests pass a fixed in-memory `tokenStore`.
    /// `autostart` runs the sync timer and the initial pull. Tests pass `false`.
    public init(
        db: AppDatabase, defaults: UserDefaults = .standard, session: URLSession = .shared, tokenStore: TokenStore? = nil,
        tokenStoreForHost: ((String) -> TokenStore)? = nil, autostart: Bool = true
    ) {
        self.db = db
        self.defaults = defaults
        self.session = session
        let fixed = tokenStore ?? (tokenStoreForHost == nil ? MemoryTokenStore() : nil)
        self.tokenStoreForHost = { host in fixed ?? tokenStoreForHost?(host) ?? MemoryTokenStore() }
        let serverURL = defaults.string(forKey: Self.serverURLKey).flatMap(URL.init(string:)) ?? Self.defaultServerURL
        self.serverURL = serverURL
        let clients = Self.makeClients(for: serverURL, session: session, store: self.tokenStoreForHost(serverURL.host ?? "server"))
        self.oauth = clients.oauth
        self.tokens = clients.tokens
        self.remoteAPI = clients.api
        self.queue = SyncQueue(db: db)
        self.isSignedIn = clients.signedIn
        self.profile = defaults.data(forKey: "profile").flatMap { try? JSONDecoder().decode(Profile.self, from: $0) }
        let stored = defaults.integer(forKey: "refreshIntervalMinutes")
        self.refreshIntervalMinutes = stored > 0 ? stored : 15
        self.hintDismissed = defaults.bool(forKey: "hintDismissed")
        self.pendingCount = (try? db.pendingOpCount()) ?? 0
        guard autostart else { return }

        scheduleTimer()
        activationObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.reloadToken += 1
                // Catch up with what happened on the web/MCP while the app was in the background.
                if self.isSignedIn, let last = self.lastSync, self.now().timeIntervalSince(last) > 60 {
                    await self.syncNow()
                } else {
                    await self.drainQueue()
                }
            }
        }
        Task { await syncNow() }
    }

    static func makeClients(for serverURL: URL, session: URLSession, store: TokenStore)
        -> (oauth: OAuthClient, tokens: TokenProvider, api: RemoteAPI, signedIn: Bool)
    {
        let oauth = OAuthClient(baseURL: serverURL, session: session)
        let tokens = TokenProvider(client: oauth, store: store)
        let api = RemoteAPI(config: RemoteConfig(baseURL: serverURL, tokens: tokens), session: session)
        return (oauth, tokens, api, store.load() != nil)
    }

    /// Points the app at another server. Only while signed out: the session, and
    /// with it the mirror, belong to one host.
    public func configureServer(_ text: String) throws {
        let url = try Self.validateServerURL(text)
        guard !isSignedIn else { throw ServerURLError.signedIn }
        guard url != serverURL else { return }
        if url == Self.defaultServerURL {
            defaults.removeObject(forKey: Self.serverURLKey)
        } else {
            defaults.set(url.absoluteString, forKey: Self.serverURLKey)
        }
        serverURL = url
        let clients = Self.makeClients(for: url, session: session, store: tokenStoreForHost(url.host ?? "server"))
        oauth = clients.oauth
        tokens = clients.tokens
        remoteAPI = clients.api
        isSignedIn = clients.signedIn
        signInError = nil
        pendingSignIn = nil
        isSigningIn = false
    }

    /// Accepts `https://host[:port][/path]`, or `http://` for localhost and `*.localhost` only.
    public static func validateServerURL(_ text: String) throws -> URL {
        var raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !raw.contains("://") { raw = "https://" + raw }
        while raw.hasSuffix("/") { raw.removeLast() }
        guard let components = URLComponents(string: raw), let host = components.host, !host.isEmpty, let url = components.url,
            components.query == nil, components.fragment == nil, components.user == nil
        else { throw ServerURLError.malformed }
        switch components.scheme?.lowercased() {
        case "https": return url
        case "http":
            let h = host.lowercased()
            guard h == "localhost" || h.hasSuffix(".localhost") || h == "127.0.0.1" else { throw ServerURLError.insecure }
            return url
        default: throw ServerURLError.malformed
        }
    }

    private func scheduleTimer() {
        timer?.invalidate()
        let interval = TimeInterval(max(5, refreshIntervalMinutes) * 60)
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.syncNow() }
        }
    }

    /// Asks the server to fetch every feed now, then pulls the result.
    public func refreshAll() async {
        guard isSignedIn, !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            _ = try await remoteAPI.refresh()
            _ = try await SyncEngine.pull(api: remoteAPI, db: db)
            lastSync = now()
            syncError = nil
            pullFailed = false
            reloadToken += 1
        } catch {
            pullFailed = true
            reportSyncFailure(error)
        }
    }

    /// Adds every non-empty line of `text`. The server resolves site/post URLs to their feed.
    /// Returns a per-line report; failures do not stop the rest and are shown in one alert.
    @discardableResult
    public func addFeeds(text: String) async -> [(String, Result<Feed, Error>)] {
        let lines = text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let results = await subscribeAll(lines.map { ($0, nil) })
        let failures = results.compactMap { line, r -> String? in
            if case .failure(let e) = r { return "\(line): \(e.localizedDescription)" } else { return nil }
        }
        if !failures.isEmpty { errorMessage = "Could not add:\n" + failures.joined(separator: "\n") }
        return results
    }

    /// Subscribes through the server one URL at a time, then pulls once if anything succeeded.
    func subscribeAll(_ entries: [(url: String, category: String?)]) async -> [(String, Result<Feed, Error>)] {
        var results: [(String, Result<Feed, Error>)] = []
        for entry in entries {
            do {
                let remote = try await remoteAPI.subscribe(url: entry.url, category: entry.category)
                results.append((entry.url, .success(Feed(title: remote.title, url: remote.url, remoteId: remote.id))))
            } catch {
                results.append((entry.url, .failure(error)))
            }
        }
        if results.contains(where: { if case .success = $0.1 { return true } else { return false } }) {
            await syncNow()
        }
        return results
    }

    public func delete(feed: Feed) {
        guard let id = feed.id else { return }
        do {
            let remoteId = feed.remoteId
            try db.deleteFeed(id: id)
            if case .feed(id) = filter { filter = .unread }
            if let remoteId { enqueue(.removeFeed(feedId: remoteId)) }
        } catch { errorMessage = error.localizedDescription }
    }

    /// Feed "always load full page" toggle, pushed to the server.
    public func setFullPage(feedId: Int64, _ on: Bool) {
        try? db.setFullPage(feedId: feedId, on)
        if let remoteId = remoteFeedId(feedId) { enqueue(.setFullPage(feedId: remoteId, fullPage: on)) }
    }

    /// Pause/resume: the server keeps the posts but stops fetching a paused feed.
    public func setEnabled(feedId: Int64, _ on: Bool) {
        try? db.setEnabled(feedId: feedId, on)
        if let remoteId = remoteFeedId(feedId) { enqueue(.setEnabled(feedId: remoteId, enabled: on)) }
    }

    // MARK: Item actions (all undoable)

    public func markRead(_ id: Int64, read: Bool = true, toast: Bool = true) {
        guard let before = try? db.item(id: id)?.isRead, before != read else { return }
        try? db.markRead(itemId: id, read: read)
        enqueueMarkRead(remoteItemIds([id]), read: read)
        undoManager.registerUndo(withTarget: self) { s in s.markRead(id, read: before, toast: false) }
        undoManager.setActionName(read ? "Mark as Read" : "Mark as Unread")
        if toast { showToast(read ? "Marked as read" : "Marked as unread") }
    }

    /// Marks every unread post in the current view as read; `feedId` narrows it to one feed regardless of the view.
    public func markAllRead(feedId: Int64? = nil) {
        var feedId = feedId
        if feedId == nil, case .feed(let id) = filter { feedId = id }
        guard let ids = try? db.markAllRead(feedId: feedId), !ids.isEmpty else { return }
        enqueueMarkRead(remoteItemIds(ids), read: true)
        undoManager.registerUndo(withTarget: self) { s in s.restoreUnread(ids) }
        undoManager.setActionName("Mark All as Read")
        showToast("Marked \(ids.count) as read")
    }

    private func restoreUnread(_ ids: [Int64]) {
        try? db.markRead(itemIds: ids, read: false)
        let rids = remoteItemIds(ids)
        enqueueMarkRead(rids, read: false)
        undoManager.registerUndo(withTarget: self) { s in
            try? s.db.markRead(itemIds: ids, read: true)
            s.enqueueMarkRead(rids, read: true)
            s.undoManager.registerUndo(withTarget: s) { $0.restoreUnread(ids) }
        }
        showToast("Restored \(ids.count) unread", undoable: false)
    }

    public func toggleStar(_ id: Int64, current: Bool, toast: Bool = true) {
        try? db.setStarred(itemId: id, starred: !current)
        if let rid = remoteItemIds([id]).first { enqueue(.setStarred(itemId: rid, starred: !current)) }
        undoManager.registerUndo(withTarget: self) { s in s.toggleStar(id, current: !current, toast: false) }
        undoManager.setActionName(current ? "Unstar" : "Star")
        if toast { showToast(current ? "Unstarred" : "Starred") }
    }

    public func toggleReadSelected() {
        guard let id = selectedItemId, let item = try? db.item(id: id) else { return }
        markRead(id, read: !item.isRead)
    }

    public func toggleStarSelected() {
        guard let id = selectedItemId, let item = try? db.item(id: id) else { return }
        toggleStar(id, current: item.starred)
    }

    public func openSelectedInBrowser() {
        guard let id = selectedItemId, let link = try? db.item(id: id)?.link, let url = URL(string: link) else { return }
        NSWorkspace.shared.open(url)
    }
}
