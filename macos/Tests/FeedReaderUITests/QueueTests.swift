import FeedReaderCore
import Foundation
import GRDB
import TestSupport
import Testing

@testable import FeedReaderUI

/// AppState on top of the write queue: local writes stick while offline and reach the server later.
@MainActor
struct QueueTests {
    private static let ok = Data(#"{"json":{"changed":["I1"]}}"#.utf8)

    /// A signed-in AppState over a mirror with one feed (F1) and two unread items (I1, I2).
    private static func signedIn(host: String) throws -> (AppState, [Int64]) {
        let db = try AppDatabase.inMemory()
        let ids = try db.writer.write { sqlite -> [Int64] in
            var feed = Feed(title: "A", url: "https://a.test/feed", remoteId: "F1")
            feed = try feed.insertAndFetch(sqlite)!
            return try ["I1", "I2"].map { rid in
                var item = Item(
                    feedId: feed.id!, guid: rid, link: nil, title: rid, author: nil, publishedAt: nil, contentHTML: nil,
                    contentText: nil, remoteId: rid)
                try item.insert(sqlite)
                return item.id!
            }
        }
        let defaults = UserDefaults(suiteName: "QueueTests-\(host)")!
        defaults.removePersistentDomain(forName: "QueueTests-\(host)")
        defaults.set("https://\(host)", forKey: "remoteServerURL")
        let tokens = MemoryTokenStore(OAuthTokens(accessToken: "at", refreshToken: "rt", expiresAt: .distantFuture))
        let state = AppState(db: db, defaults: defaults, session: stubbedSession(), tokenStore: tokens, autostart: false)
        #expect(state.isSignedIn)
        return (state, ids)
    }

    @Test func offlineWritesStayLocalAndPushWhenBackOnline() async throws {
        let host = "queue-state.test"
        let markRead = "https://\(host)/api/rpc/reader/markRead"
        StubURLProtocol.stub(markRead, [.offline()])
        let (state, ids) = try Self.signedIn(host: host)

        state.markRead(ids[0])
        state.markRead(ids[0], read: false)
        state.markRead(ids[0])
        state.toggleStar(ids[1], current: false)
        await state.retryNow()
        #expect(try state.db.item(id: ids[0])?.isRead == true, "the mirror keeps the local write")
        #expect(try state.db.item(id: ids[1])?.starred == true)
        #expect(state.pendingCount == 2, "read flips for one item coalesce into the last one")
        #expect(state.errorMessage == nil, "being offline is not an error")
        #expect(state.syncError == nil)

        StubURLProtocol.stub([markRead: Self.ok, "https://\(host)/api/rpc/reader/updateItem": Self.ok])
        await state.retryNow()
        #expect(state.pendingCount == 0)
        let pushed = StubURLProtocol.requests(to: markRead).compactMap { $0.body }.map { String(decoding: $0, as: UTF8.self) }
        #expect(pushed.last?.contains(#""read":true"#) == true)
    }

    @Test func syncPushesBeforeItPullsSoTheServerDoesNotWinOverAQueuedWrite() async throws {
        let host = "queue-sync.test"
        StubURLProtocol.stub([
            "https://\(host)/api/rpc/reader/markRead": Self.ok,
            "https://\(host)/api/rpc/reader/sync": Data(
                """
                {"json":{"feeds":[{"id":"F1","title":"A","url":"https://a.test/feed","siteUrl":null,"category":null,"enabled":true,
                "fullPage":false,"lastFetchedAt":null,"lastError":null}],"items":[
                {"id":"I1","feedId":"F1","guid":"I1","link":null,"title":"I1","author":null,"publishedAt":null,"contentHtml":null,
                "contentText":null,"readAt":null,"starred":false,"notes":null,"tags":[],"analyses":[]}]}}
                """.utf8),
        ])
        let (state, ids) = try Self.signedIn(host: host)
        try state.db.enqueue(.markRead(itemIds: ["I1"], read: true))
        try state.db.markRead(itemId: ids[0], read: true)
        state.refreshPendingCount()

        await state.syncNow()
        let calls = StubURLProtocol.requestedURLs().filter { $0.contains(host) }.map { $0.split(separator: "/").last ?? "" }
        #expect(calls == ["markRead", "sync"], "the queued write is pushed before the pull")
        #expect(state.pendingCount == 0)
        #expect(state.syncError == nil)
    }

    /// A write made (and pushed) while the server's dump is already on its way must survive the pull:
    /// the dump predates the push, so applying it alone would revert the write until the next pull.
    @Test func writePushedWhileAPullIsInFlightIsNotRevertedByTheStaleDump() async throws {
        let host = "queue-race.test"
        StubURLProtocol.stub([
            "https://\(host)/api/rpc/reader/markRead": Self.ok
        ])
        StubURLProtocol.stub(
            "https://\(host)/api/rpc/reader/sync",
            [
                .init(
                    body: Data(
                        """
                        {"json":{"feeds":[{"id":"F1","title":"A","url":"https://a.test/feed","siteUrl":null,"category":null,"enabled":true,
                        "fullPage":false,"lastFetchedAt":null,"lastError":null}],"items":[
                        {"id":"I1","feedId":"F1","guid":"I1","link":null,"title":"I1","author":null,"publishedAt":null,"contentHtml":null,
                        "contentText":null,"readAt":null,"starred":false,"notes":null,"tags":[],"analyses":[]}]}}
                        """.utf8), delay: 0.6)
            ])
        let (state, ids) = try Self.signedIn(host: host)

        let pull = Task { await state.syncNow() }
        try await Task.sleep(for: .milliseconds(200))
        state.markRead(ids[0])
        await state.retryNow()
        #expect(state.pendingCount == 0, "the write was pushed while the dump was still on its way")
        await pull.value

        let calls = StubURLProtocol.requestedURLs().filter { $0.contains(host) }.map { $0.split(separator: "/").last ?? "" }
        #expect(calls == ["sync", "markRead"], "the pull started before the push")
        #expect(try state.db.item(id: ids[0])?.isRead == true, "the stale dump did not revert the pushed write")
        #expect(state.syncError == nil)
    }

    @Test func pullFailureShowsInTheFooterAndClearsOnTheNextSuccess() async throws {
        let host = "queue-pullfail.test"
        let sync = "https://\(host)/api/rpc/reader/sync"
        StubURLProtocol.stub(sync, [.init(status: 503, body: Data("down".utf8))])
        let (state, _) = try Self.signedIn(host: host)
        await state.syncNow()
        #expect(state.syncError != nil)
        #expect(state.errorMessage == nil)
        #expect(SyncStatusLine.make(lastSync: nil, now: Date(), pending: 0, failed: state.syncError != nil).text == "Couldn’t sync")

        StubURLProtocol.stub([sync: Data(#"{"json":{"feeds":[],"items":[]}}"#.utf8)])
        await state.retryNow()
        #expect(state.syncError == nil, "Retry pulls again when nothing is queued")
        #expect(state.lastSync != nil)
    }

    @Test func definitiveRejectionIsDroppedAndReported() async throws {
        let host = "queue-reject.test"
        StubURLProtocol.stub([
            "https://\(host)/api/rpc/reader/removeFeed": Data(#"{"json":{"success":true}}"#.utf8)
        ])
        StubURLProtocol.stub(
            "https://\(host)/api/rpc/reader/markRead",
            [.init(status: 400, body: Data(#"{"json":{"code":"BAD_REQUEST","message":"unknown item"}}"#.utf8))])
        let (state, ids) = try Self.signedIn(host: host)
        state.markRead(ids[0])
        state.delete(feed: try #require(try state.db.enabledFeeds().first))
        await state.retryNow()
        #expect(state.pendingCount == 0)
        #expect(state.errorMessage == nil, "background failures never open an alert")
        #expect(state.syncError?.contains("unknown item") == true)
        #expect(StubURLProtocol.requests(to: "https://\(host)/api/rpc/reader/removeFeed").count == 1, "the drain went on past the drop")
    }

    @Test func expiredGrantRoutesToSignInAndKeepsTheQueue() async throws {
        let host = "queue-expired.test"
        StubURLProtocol.stub([
            "https://\(host)/api/rpc/reader/markRead": Self.ok
        ])
        let (state, ids) = try Self.signedIn(host: host)
        await state.tokens.clear()
        state.markRead(ids[0])
        await state.retryNow()
        #expect(!state.isSignedIn)
        #expect(state.signInError == OAuthError.signedOut.localizedDescription)
        #expect(try state.db.pendingOpCount() == 1)
    }

    @Test func signOutWipesTheQueue() async throws {
        let host = "queue-signout.test"
        StubURLProtocol.stub("https://\(host)/api/rpc/reader/markRead", [.offline()])
        let (state, ids) = try Self.signedIn(host: host)
        state.markRead(ids[0])
        await state.retryNow()
        #expect(state.pendingCount == 1)
        await state.signOut()
        #expect(state.pendingCount == 0)
        #expect(try state.db.pendingOpCount() == 0)
    }

    @Test func backoffGrowsAndCaps() {
        #expect(AppState.backoff(attempts: 1) == 10)
        #expect(AppState.backoff(attempts: 3) == 40)
        #expect(AppState.backoff(attempts: 20) == 300)
    }
}

/// The server field on the sign-in screen.
@MainActor
struct ServerConfigTests {
    private static func signedOut(suite: String) throws -> AppState {
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return AppState(db: try AppDatabase.inMemory(), defaults: defaults, session: stubbedSession(), autostart: false)
    }

    @Test func validation() throws {
        #expect(try AppState.validateServerURL("https://reader.example.com/").absoluteString == "https://reader.example.com")
        #expect(try AppState.validateServerURL(" reader.example.com ").absoluteString == "https://reader.example.com")
        #expect(try AppState.validateServerURL("http://localhost:3000").absoluteString == "http://localhost:3000")
        #expect(try AppState.validateServerURL("http://feedreader.localhost").host == "feedreader.localhost")
        #expect(throws: ServerURLError.insecure) { try AppState.validateServerURL("http://reader.example.com") }
        #expect(throws: ServerURLError.malformed) { try AppState.validateServerURL("") }
        #expect(throws: ServerURLError.malformed) { try AppState.validateServerURL("ftp://reader.example.com") }
        #expect(throws: ServerURLError.malformed) { try AppState.validateServerURL("https://reader.example.com/?x=1") }
    }

    @Test func changingTheServerRebuildsTheClientsAndPersists() throws {
        let state = try Self.signedOut(suite: "ServerConfigTests-change")
        #expect(state.serverURL == AppState.defaultServerURL)
        try state.configureServer("https://other.example.com")
        #expect(state.serverURL.absoluteString == "https://other.example.com")
        #expect(state.remoteAPI.config.baseURL.absoluteString == "https://other.example.com")
        #expect(state.oauth.baseURL.absoluteString == "https://other.example.com")
        #expect(state.defaults.string(forKey: "remoteServerURL") == "https://other.example.com")

        try state.configureServer(AppState.defaultServerURL.absoluteString)
        #expect(state.defaults.string(forKey: "remoteServerURL") == nil, "the default is not persisted")
        #expect(state.remoteAPI.config.baseURL == AppState.defaultServerURL)
    }

    @Test func changingTheServerSwitchesTheSessionStore() throws {
        let stores: [String: MemoryTokenStore] = [
            "a.test": MemoryTokenStore(),
            "b.test": MemoryTokenStore(OAuthTokens(accessToken: "at", refreshToken: "rt", expiresAt: .distantFuture)),
        ]
        let defaults = UserDefaults(suiteName: "ServerConfigTests-store")!
        defaults.removePersistentDomain(forName: "ServerConfigTests-store")
        defaults.set("https://a.test", forKey: "remoteServerURL")
        let state = AppState(
            db: try AppDatabase.inMemory(), defaults: defaults, session: stubbedSession(),
            tokenStoreForHost: { stores[$0] ?? MemoryTokenStore() }, autostart: false)
        #expect(!state.isSignedIn)
        try state.configureServer("https://b.test")
        #expect(state.isSignedIn, "b.test already has a session on this Mac")
        #expect(throws: ServerURLError.signedIn) { try state.configureServer("https://a.test") }
        #expect(state.serverURL.host == "b.test")
    }
}
