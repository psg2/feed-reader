import Foundation
import GRDB
import TestSupport
import Testing

@testable import FeedReaderCore

/// The offline write queue: what gets stored, how it drains, and how a pull treats it.
@Suite
struct SyncQueueTests {
    private static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: config)
    }

    private static func api(_ host: String) -> RemoteAPI {
        RemoteAPI(config: RemoteConfig(baseURL: URL(string: "https://\(host)")!, apiKey: "app_test"), session: session())
    }

    /// One mirrored feed (F1) with two mirrored items (I1 unread, I2 read).
    private static func mirror() throws -> AppDatabase {
        let db = try AppDatabase.inMemory()
        try db.writer.write { sqlite in
            var feed = Feed(title: "A", url: "https://a.test/feed", remoteId: "F1")
            feed = try feed.insertAndFetch(sqlite)!
            for (rid, read) in [("I1", false), ("I2", true)] {
                var item = Item(
                    feedId: feed.id!, guid: rid, link: nil, title: rid, author: nil, publishedAt: nil, contentHTML: nil,
                    contentText: nil, readAt: read ? Date() : nil, remoteId: rid)
                try item.insert(sqlite)
            }
        }
        return db
    }

    private static let ok = Data(#"{"json":{"changed":["I1"]}}"#.utf8)

    @Test func payloadRoundTripsAndCoalescesByKey() throws {
        let db = try AppDatabase.inMemory()
        try db.enqueue(.markRead(itemIds: ["I1"], read: true))
        try db.enqueue(.setStarred(itemId: "I1", starred: true))
        try db.enqueue(.markRead(itemIds: ["I1", "I2"], read: true))
        try db.enqueue(.markRead(itemIds: ["I1"], read: false))
        try db.enqueue(.setStarred(itemId: "I1", starred: false))

        let ops = try db.pendingOps().map(\.op)
        #expect(
            ops == [
                .markRead(itemIds: ["I1", "I2"], read: true),
                .markRead(itemIds: ["I1"], read: false),
                .setStarred(itemId: "I1", starred: false),
            ], "the latest read/star wins, bulk marks are kept in order")
        let first = try #require(try db.pendingOps().first)
        #expect(first.kind == "markRead")
        #expect(first.attempts == 0)
        #expect(first.coalesceKey == nil)
    }

    @Test func offlineKeepsTheOpAndGoingOnlineDrainsInOrder() async throws {
        let markRead = "https://queue-offline.test/api/rpc/reader/markRead"
        let updateItem = "https://queue-offline.test/api/rpc/reader/updateItem"
        StubURLProtocol.stub(markRead, [.offline()])
        StubURLProtocol.stub([updateItem: Self.ok])
        let db = try Self.mirror()
        try db.enqueue(.markRead(itemIds: ["I1"], read: true))
        try db.enqueue(.setStarred(itemId: "I1", starred: true))
        let queue = SyncQueue(db: db)
        let api = Self.api("queue-offline.test")

        let stalled = try await queue.drain(api: api)
        #expect(stalled.pushed == 0)
        #expect(stalled.remaining)
        #expect(stalled.attempts == 1)
        let rows = try db.pendingOps()
        #expect(rows.count == 2, "nothing is lost while offline")
        #expect(rows[0].attempts == 1)
        #expect(rows[0].lastError != nil)
        #expect(StubURLProtocol.requests(to: updateItem).isEmpty, "later ops wait behind the stalled one")

        StubURLProtocol.stub([markRead: Self.ok])
        let drained = try await queue.drain(api: api)
        #expect(drained == SyncQueue.Outcome(pushed: 2))
        #expect(try db.pendingOpCount() == 0)
        #expect(StubURLProtocol.requests(to: markRead).count == 2)
        #expect(StubURLProtocol.requests(to: updateItem).count == 1)
        let body = String(decoding: StubURLProtocol.requests(to: updateItem)[0].body ?? Data(), as: UTF8.self)
        #expect(body.contains(#""starred":true"#))
    }

    @Test func serverErrorsRetryButDefinitiveRejectionsDrop() async throws {
        let markRead = "https://queue-4xx.test/api/rpc/reader/markRead"
        let removeFeed = "https://queue-4xx.test/api/rpc/reader/removeFeed"
        StubURLProtocol.stub(
            markRead,
            [
                .init(status: 503, body: Data("down".utf8)),
                .init(status: 429, body: Data(#"{"json":{"code":"TOO_MANY_REQUESTS","message":"slow down"}}"#.utf8)),
                .init(status: 404, body: Data(#"{"json":{"code":"NOT_FOUND","message":"no such item"}}"#.utf8)),
            ])
        StubURLProtocol.stub([removeFeed: Data(#"{"json":{"success":true}}"#.utf8)])
        let db = try Self.mirror()
        try db.enqueue(.markRead(itemIds: ["gone"], read: true))
        try db.enqueue(.removeFeed(feedId: "F1"))
        let queue = SyncQueue(db: db)
        let api = Self.api("queue-4xx.test")

        #expect(try await queue.drain(api: api).remaining, "503 is transient")
        #expect(try await queue.drain(api: api).remaining, "429 is transient")
        #expect(try db.pendingOps().first?.attempts == 2)

        let outcome = try await queue.drain(api: api)
        #expect(outcome.pushed == 1)
        #expect(outcome.dropped.map(\.0) == [.markRead(itemIds: ["gone"], read: true)])
        #expect(outcome.dropped.first?.1.contains("no such item") == true)
        #expect(!outcome.remaining)
        #expect(try db.pendingOpCount() == 0, "the 404 op is dropped and the rest continues")
    }

    @Test func signedOutStopsTheDrainAndKeepsTheQueue() async throws {
        let db = try Self.mirror()
        try db.enqueue(.markRead(itemIds: ["I1"], read: true))
        let client = OAuthClient(baseURL: URL(string: "https://queue-auth.test")!, session: Self.session())
        let tokens = TokenProvider(client: client, store: MemoryTokenStore())
        let api = RemoteAPI(config: RemoteConfig(baseURL: URL(string: "https://queue-auth.test")!, tokens: tokens), session: Self.session())
        await #expect(throws: OAuthError.signedOut) { try await SyncQueue(db: db).drain(api: api) }
        #expect(try db.pendingOpCount() == 1)
        #expect(try db.pendingOps().first?.attempts == 0)
    }

    @Test func pullReplaysQueuedWritesOverTheServerState() async throws {
        // Offline: I1 marked read, I2 starred, F1 set to full page. The server still has the old state.
        let sync = "https://queue-pull.test/api/rpc/reader/sync"
        let markRead = "https://queue-pull.test/api/rpc/reader/markRead"
        StubURLProtocol.stub(markRead, [.offline()])
        StubURLProtocol.stub([
            sync: Data(
                """
                {"json":{"feeds":[{"id":"F1","title":"A","url":"https://a.test/feed","siteUrl":null,"category":null,"enabled":true,
                "fullPage":false,"lastFetchedAt":null,"lastError":null}],"items":[
                {"id":"I1","feedId":"F1","guid":"I1","link":null,"title":"I1","author":null,"publishedAt":null,"contentHtml":null,
                "contentText":null,"readAt":null,"starred":false,"notes":null,"tags":[],"analyses":[]},
                {"id":"I2","feedId":"F1","guid":"I2","link":null,"title":"I2","author":null,"publishedAt":null,"contentHtml":null,
                "contentText":null,"readAt":"2026-08-21T10:00:00.000Z","starred":false,"notes":null,"tags":["old"],"analyses":[]}]}}
                """.utf8)
        ])
        let db = try Self.mirror()
        try db.markRead(itemIds: [1], read: true)
        try db.enqueue(.markRead(itemIds: ["I1"], read: true))
        try db.enqueue(.setStarred(itemId: "I2", starred: true))
        try db.enqueue(.setTags(itemId: "I2", tags: ["new"]))
        try db.enqueue(.setFullPage(feedId: "F1", fullPage: true))
        let api = Self.api("queue-pull.test")
        _ = try? await SyncQueue(db: db).drain(api: api)
        #expect(try db.pendingOpCount() == 4)

        _ = try await SyncEngine.pull(api: api, db: db)
        let items = try await db.reader.read { try Item.order(Column("guid")).fetchAll($0) }
        #expect(items[0].isRead, "the pull did not revert the queued read")
        #expect(items[1].starred, "nor the queued star")
        #expect(try db.tags(for: items[1].id!) == ["new"])
        #expect(try db.enabledFeeds().first?.fullPage == true)

        // Once the push goes through, the next pull takes the server's word again.
        StubURLProtocol.stub([markRead: Self.ok])
        StubURLProtocol.stub(["https://queue-pull.test/api/rpc/reader/updateItem": Self.ok])
        StubURLProtocol.stub(["https://queue-pull.test/api/rpc/reader/updateFeed": Self.ok])
        #expect(try await SyncQueue(db: db).drain(api: api).pushed == 4)
        _ = try await SyncEngine.pull(api: api, db: db)
        let after = try await db.reader.read { try Item.order(Column("guid")).fetchAll($0) }
        #expect(!after[0].isRead)
        #expect(!after[1].starred)
    }

    @Test func undecodableAnswerIsDefinitiveAndDoesNotBlockTheQueue() async throws {
        let markRead = "https://queue-decode.test/api/rpc/reader/markRead"
        let updateItem = "https://queue-decode.test/api/rpc/reader/updateItem"
        StubURLProtocol.stub([markRead: Data("<html>not json</html>".utf8), updateItem: Self.ok])
        let db = try Self.mirror()
        try db.enqueue(.markRead(itemIds: ["I1"], read: true))
        try db.enqueue(.setStarred(itemId: "I1", starred: true))

        let outcome = try await SyncQueue(db: db).drain(api: Self.api("queue-decode.test"))
        #expect(outcome.dropped.map(\.0) == [.markRead(itemIds: ["I1"], read: true)])
        #expect(outcome.dropped.first?.1.contains("Unexpected server response") == true)
        #expect(outcome.pushed == 1, "the op behind it went through")
        #expect(!outcome.remaining)
        #expect(try db.pendingOpCount() == 0)
    }

    @Test func transientFailuresGiveUpAfterTheAttemptCapButOfflineNeverDoes() async throws {
        let markRead = "https://queue-cap.test/api/rpc/reader/markRead"
        StubURLProtocol.stub(markRead, [.init(status: 503, body: Data("down".utf8))])
        let db = try Self.mirror()
        try db.enqueue(.markRead(itemIds: ["I1"], read: true))
        let queue = SyncQueue(db: db)
        let api = Self.api("queue-cap.test")

        for attempt in 1..<SyncQueue.maxAttempts {
            let outcome = try await queue.drain(api: api)
            #expect(outcome.remaining && outcome.attempts == attempt)
        }
        let last = try await queue.drain(api: api)
        #expect(!last.remaining)
        #expect(last.dropped.map(\.0) == [.markRead(itemIds: ["I1"], read: true)])
        #expect(try db.pendingOpCount() == 0, "a 5xx that never goes away is dropped after \(SyncQueue.maxAttempts) attempts")

        StubURLProtocol.stub(markRead, [.offline()])
        try db.enqueue(.markRead(itemIds: ["I2"], read: false))
        for _ in 0..<(SyncQueue.maxAttempts + 2) {
            #expect(try await queue.drain(api: api).remaining)
        }
        #expect(try db.pendingOpCount() == 1, "offline attempts are not counted against the op")
    }

    @Test func pullBookkeepingRemembersOpsPushedWhileAPullIsInFlight() throws {
        let db = try Self.mirror()
        db.notePushed(.setStarred(itemId: "I1", starred: true))
        let first = db.beginPull()
        db.notePushed(.markRead(itemIds: ["I1"], read: true))
        let second = db.beginPull()
        db.notePushed(.setNotes(itemId: "I2", notes: "n"))
        #expect(db.takePushed(since: second) == [.setNotes(itemId: "I2", notes: "n")])
        #expect(db.takePushed(since: first) == [.markRead(itemIds: ["I1"], read: true), .setNotes(itemId: "I2", notes: "n")])
        #expect(db.takePushed(since: db.beginPull()) == [], "nothing is kept between pulls")

        let marker = db.beginPull()
        db.notePushed(.markRead(itemIds: ["I1"], read: true))
        try db.enqueue(.setStarred(itemId: "I2", starred: true))
        try db.finishPull(since: marker)
        #expect(try db.item(id: 1)?.isRead == true, "the pushed op is replayed")
        #expect(try db.item(id: 2)?.starred == true, "and so is the queued one")
    }

    @Test func wipeClearsTheQueue() throws {
        let db = try Self.mirror()
        try db.enqueue(.removeFeed(feedId: "F1"))
        try db.wipe()
        #expect(try db.pendingOpCount() == 0)
    }
}
