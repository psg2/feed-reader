import Foundation
import GRDB
import TestSupport
import Testing

@testable import FeedReaderCore

private func stubbedSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubURLProtocol.self]
    return URLSession(configuration: config)
}

private let base = URL(string: "https://reader.test")!

private func dumpJSON(feeds: [[String: Any]], items: [[String: Any]]) -> Data {
    let body: [String: Any] = ["json": ["feeds": feeds, "items": items]]
    return try! JSONSerialization.data(withJSONObject: body)
}

private func feedJSON(id: String, url: String, title: String = "Feed") -> [String: Any] {
    [
        "id": id, "title": title, "url": url, "siteUrl": "https://site.test",
        "category": NSNull(), "enabled": true, "fullPage": false,
        "lastFetchedAt": "2026-08-23T18:00:00.000Z", "lastError": NSNull(),
    ]
}

private func itemJSON(
    id: String, feedId: String, guid: String, title: String = "Post",
    readAt: Any = NSNull(), starred: Bool = false, notes: Any = NSNull(), tags: [String] = []
) -> [String: Any] {
    [
        "id": id, "feedId": feedId, "guid": guid, "link": "https://site.test/p",
        "title": title, "author": "A", "publishedAt": "2026-08-20T12:30:00.000Z",
        "contentHtml": "<p>hi</p>", "contentText": "hi",
        "readAt": readAt, "starred": starred, "notes": notes,
        "tags": tags, "analyses": [] as [[String: Any]],
    ]
}

@Suite
struct RemoteSyncTests {

    @Test
    func syncPullMirrorsServerState() async throws {
        let db = try AppDatabase.inMemory()
        StubURLProtocol.stub([
            "https://reader.test/api/rpc/reader/sync": dumpJSON(
                feeds: [feedJSON(id: "F1", url: "https://a.test/feed", title: "A")],
                items: [
                    itemJSON(id: "I1", feedId: "F1", guid: "g1", title: "One", readAt: "2026-08-21T10:00:00.000Z"),
                    itemJSON(id: "I2", feedId: "F1", guid: "g2", title: "Two", starred: true, notes: "n", tags: ["swift", "ai"]),
                ])
        ])
        let api = RemoteAPI(config: RemoteConfig(baseURL: base, apiKey: "app_test"), session: stubbedSession())

        let summary = try await SyncEngine.pull(api: api, db: db)
        #expect(summary.feeds == 1)
        #expect(summary.items == 2)

        let feeds = try await db.reader.read { try Feed.fetchAll($0) }
        #expect(feeds.count == 1)
        #expect(feeds[0].remoteId == "F1")
        #expect(feeds[0].title == "A")
        #expect(feeds[0].lastFetchedAt != nil)

        let items = try await db.reader.read { try Item.order(Column("guid")).fetchAll($0) }
        #expect(items.count == 2)
        #expect(items[0].isRead)
        #expect(items[1].starred)
        #expect(items[1].notes == "n")
        #expect(items[1].publishedAt != nil)
        let tags = try await db.reader.read { try Tag.fetchAll($0) }.map(\.tag).sorted()
        #expect(tags == ["ai", "swift"])
    }

    @Test
    func applyIsIdempotentAndRemovesServerDeletedRows() async throws {
        let db = try AppDatabase.inMemory()
        let full = try JSONDecoder().decode(
            Wrapper.self,
            from: dumpJSON(
                feeds: [feedJSON(id: "F1", url: "https://a.test/feed")],
                items: [
                    itemJSON(id: "I1", feedId: "F1", guid: "g1"),
                    itemJSON(id: "I2", feedId: "F1", guid: "g2"),
                ])
        ).json

        _ = try await SyncEngine.apply(full, db: db)
        let second = try await SyncEngine.apply(full, db: db)
        #expect(second.items == 2)
        let count = try await db.reader.read { try Item.fetchCount($0) }
        #expect(count == 2)  // no duplicates on re-apply

        // Server dropped I2 → mirror drops it too. Pure-local rows survive.
        try await db.writer.write { sqlite in
            var local = Item(
                feedId: try Feed.fetchOne(sqlite)!.id!, guid: "local-only", link: nil,
                title: "Local", author: nil, publishedAt: nil, contentHTML: nil, contentText: nil)
            try local.insert(sqlite)
        }
        let pruned = try JSONDecoder().decode(
            Wrapper.self,
            from: dumpJSON(
                feeds: [feedJSON(id: "F1", url: "https://a.test/feed")],
                items: [itemJSON(id: "I1", feedId: "F1", guid: "g1")])
        ).json
        let third = try await SyncEngine.apply(pruned, db: db)
        #expect(third.removedItems == 1)
        let remaining = try await db.reader.read { try Item.order(Column("guid")).fetchAll($0) }
        #expect(remaining.map(\.guid) == ["g1", "local-only"])
    }

    @Test
    func adoptsExistingLocalRowsByUrlAndGuid() async throws {
        // An imported/local DB re-linked to the server: rows match by url/guid
        // and gain remoteIds instead of being duplicated.
        let db = try AppDatabase.inMemory()
        try await db.writer.write { sqlite in
            var feed = Feed(title: "Old", url: "https://a.test/feed")
            feed = try feed.insertAndFetch(sqlite)!
            var item = Item(
                feedId: feed.id!, guid: "g1", link: nil, title: "Old title", author: nil,
                publishedAt: nil, contentHTML: nil, contentText: nil)
            try item.insert(sqlite)
        }
        let dump = try JSONDecoder().decode(
            Wrapper.self,
            from: dumpJSON(
                feeds: [feedJSON(id: "F1", url: "https://a.test/feed", title: "New")],
                items: [itemJSON(id: "I1", feedId: "F1", guid: "g1", title: "New title")])
        ).json
        _ = try await SyncEngine.apply(dump, db: db)
        let feeds = try await db.reader.read { try Feed.fetchAll($0) }
        let items = try await db.reader.read { try Item.fetchAll($0) }
        #expect(feeds.count == 1)
        #expect(items.count == 1)
        #expect(feeds[0].remoteId == "F1")
        #expect(feeds[0].title == "New")
        #expect(items[0].remoteId == "I1")
        #expect(items[0].title == "New title")
    }

    @Test
    func remoteAPISendsBearerAndDecodesErrors() async throws {
        StubURLProtocol.stub([
            "https://reader.test/api/rpc/reader/refresh": Data(
                #"{"json":{"feedsChecked":3,"feedsFailed":1,"newItems":7}}"#.utf8)
        ])
        let api = RemoteAPI(config: RemoteConfig(baseURL: base, apiKey: "app_test"), session: stubbedSession())
        let summary = try await api.refresh()
        #expect(summary.feedsChecked == 3)
        #expect(summary.newItems == 7)

        // Unstubbed route → 404 → RemoteError
        await #expect(throws: RemoteError.self) {
            try await api.markRead(remoteIds: ["I1"], read: true)
        }
    }

    private struct Wrapper: Decodable { let json: RemoteAPI.SyncDump }
}
