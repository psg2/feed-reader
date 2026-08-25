import FeedReaderCore
import Foundation
import TestSupport
import Testing

@testable import FeedReaderUI

@MainActor
struct ModelTests {
    /// In-memory DB with one feed and three items: newest unread, middle unread, oldest read.
    static func seeded() throws -> (AppDatabase, Feed, [Int64]) {
        let db = try AppDatabase.inMemory()
        let feed = try db.addFeed(Feed(title: "Blog", url: "https://blog.test/feed"))
        var ids: [Int64] = []
        for (i, title) in ["Newest", "Middle", "Oldest"].enumerated() {
            var item = Item(
                feedId: feed.id!, guid: "g\(i)", link: "https://blog.test/\(i)", title: title, author: nil,
                publishedAt: Date(timeIntervalSince1970: 1_000_000 - Double(i) * 3600),
                contentHTML: "<p>\(title)</p>", contentText: title, readAt: i == 2 ? Date() : nil)
            ids.append(
                try db.writer.write { db in
                    try item.insert(db); return item.id!
                })
        }
        return (db, feed, ids)
    }

    @Test func sidebarCountsAndTags() async throws {
        let (db, _, ids) = try Self.seeded()
        let sidebar = SidebarModel(db: db)
        #expect(sidebar.feeds.count == 1)
        #expect(sidebar.totalUnread == 2)
        try db.setTags(itemId: ids[0], tags: ["swift"])
        // ValueObservation delivers asynchronously after the first immediate value.
        try await Task.sleep(for: .milliseconds(100))
        #expect(sidebar.tags == ["swift"])
    }

    @Test func sidebarSplitsNewslettersFromWebFeeds() throws {
        let (db, _, _) = try Self.seeded()
        try db.addFeed(Feed(title: "Weekly", url: "mailto:weekly@newsletters.test"))
        try db.addFeed(Feed(title: "Digest", url: "https://kill-the-newsletter.com/feeds/abc123.xml"))
        let sidebar = SidebarModel(db: db)
        #expect(sidebar.webFeeds.map(\.feed.title) == ["Blog"])
        #expect(sidebar.newsletters.map(\.feed.title) == ["Digest", "Weekly"])
        #expect(sidebar.newsletters[0].feed.isNewsletter)
    }

    @Test func listFilters() throws {
        let (db, feed, _) = try Self.seeded()
        let list = ItemListModel(db: db, filter: .unread)
        #expect(list.rows.map(\.item.title) == ["Newest", "Middle"])
        list.update(filter: .all, search: "")
        #expect(list.rows.count == 3)
        list.update(filter: .all, search: "old")
        #expect(list.rows.map(\.item.title) == ["Oldest"])
        list.update(filter: .feed(feed.id!), search: "")
        #expect(list.rows.count == 3)
        #expect(list.error == nil)
    }

    @Test func listKeepsJustReadSelectionVisible() async throws {
        let (db, _, ids) = try Self.seeded()
        let list = ItemListModel(db: db, filter: .unread)
        list.selectedItemId = ids[0]
        try db.markRead(itemId: ids[0], read: true)
        try await Task.sleep(for: .milliseconds(100))
        #expect(list.rows.map(\.item.title) == ["Newest", "Middle"], "selected row stays until selection moves")
        #expect(list.row(id: ids[0])?.item.isRead == true, "but reflects the persisted read state")
        list.selectedItemId = ids[1]
        list.reload()
        #expect(list.rows.map(\.item.title) == ["Middle"])
    }

    @Test func neighbours() throws {
        let (db, _, ids) = try Self.seeded()
        let list = ItemListModel(db: db, filter: .all)
        #expect(list.neighbour(of: nil, offset: 1) == ids[0])
        #expect(list.neighbour(of: ids[0], offset: 1) == ids[1])
        #expect(list.neighbour(of: ids[2], offset: 1) == nil)
        #expect(list.neighbour(of: ids[1], offset: -1) == ids[0])
    }

    @Test func detailAutosavesNotesAndTags() async throws {
        let (db, _, ids) = try Self.seeded()
        let detail = ItemDetailModel(db: db, itemId: ids[0], debounceMs: 20)
        #expect(detail.item?.title == "Newest")
        #expect(detail.feedTitle == "Blog")
        detail.notes = "learned X"
        detail.tagsText = "Swift, LLM"
        // Debounce runs on the main actor, which snapshot tests can hog; poll instead of a fixed sleep.
        for _ in 0..<100 {
            let saved = try !db.tags(for: ids[0]).isEmpty && db.item(id: ids[0])?.notes != nil
            if saved { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(try db.item(id: ids[0])?.notes == "learned X")
        #expect(try db.tags(for: ids[0]) == ["llm", "swift"])
    }

    @Test func relativeText() {
        let now = Date()
        #expect(RelativeText.string(from: now.addingTimeInterval(-5), now: now) == "just now")
        #expect(RelativeText.string(from: now.addingTimeInterval(-3600), now: now) == "1h ago")
    }
}

@MainActor
struct AddFeedsTests {
    @Test func addsFeedsThroughTheServerAndReportsFailures() async throws {
        // Every line goes to the server's `subscribe`; the mirror is pulled afterwards.
        let session = stubbedSession([
            "https://addfeeds.test/api/rpc/reader/subscribe": Data(
                #"{"json":{"id":"F1","title":"Site Blog","url":"https://site.test/feed.atom","siteUrl":null,"category":null,"enabled":true,"fullPage":false}}"#
                    .utf8),
            "https://addfeeds.test/api/rpc/reader/sync": Data(
                #"{"json":{"feeds":[{"id":"F1","title":"Site Blog","url":"https://site.test/feed.atom","siteUrl":null,"category":null,"enabled":true,"fullPage":false,"lastFetchedAt":null,"lastError":null}],"items":[]}}"#
                    .utf8),
        ])
        let db = try AppDatabase.inMemory()
        let defaults = UserDefaults(suiteName: "AddFeedsTests")!
        defaults.set("https://addfeeds.test", forKey: "remoteServerURL")
        let tokens = MemoryTokenStore(OAuthTokens(accessToken: "at", refreshToken: "rt", expiresAt: .distantFuture))
        let state = AppState(db: db, defaults: defaults, session: session, tokenStore: tokens, autostart: false)
        #expect(state.isSignedIn)
        let results = await state.addFeeds(text: "https://site.test/\n\nhttps://site.test/feed.atom\n")
        #expect(results.count == 2)
        let feeds = try db.enabledFeeds()
        #expect(feeds.map(\.url) == ["https://site.test/feed.atom"], "the mirror reflects the server after the pull")
        #expect(feeds.first?.remoteId == "F1")
        #expect(state.errorMessage == nil)
    }

    @Test func importOPMLSkipsKnownFeedsAndReportsCounts() async throws {
        let host = "opml-import.test"
        let subscribe = "https://\(host)/api/rpc/reader/subscribe"
        StubURLProtocol.stub(
            subscribe,
            [
                .init(
                    body: Data(
                        #"{"json":{"id":"F2","title":"New","url":"https://new.test/feed","siteUrl":null,"category":"Tech","enabled":true,"fullPage":false}}"#
                            .utf8)),
                .init(status: 400, body: Data(#"{"json":{"code":"BAD_REQUEST","message":"no feed found"}}"#.utf8)),
            ])
        StubURLProtocol.stub([
            "https://\(host)/api/rpc/reader/sync": Data(
                #"{"json":{"feeds":[{"id":"F1","title":"Known","url":"https://known.test/feed","siteUrl":null,"category":null,"enabled":true,"fullPage":false,"lastFetchedAt":null,"lastError":null},{"id":"F2","title":"New","url":"https://new.test/feed","siteUrl":null,"category":"Tech","enabled":true,"fullPage":false,"lastFetchedAt":null,"lastError":null}],"items":[]}}"#
                    .utf8)
        ])
        let db = try AppDatabase.inMemory()
        try db.addFeed(Feed(title: "Known", url: "https://known.test/feed", remoteId: "F1"))
        let defaults = UserDefaults(suiteName: "OPMLImportTests")!
        defaults.set("https://\(host)", forKey: "remoteServerURL")
        let tokens = MemoryTokenStore(OAuthTokens(accessToken: "at", refreshToken: "rt", expiresAt: .distantFuture))
        let state = AppState(db: db, defaults: defaults, session: stubbedSession(), tokenStore: tokens, autostart: false)
        let opml = """
            <opml version="2.0"><body>
              <outline text="Tech">
                <outline xmlUrl="https://new.test/feed" text="New"/>
                <outline xmlUrl="https://broken.test/feed" text="Broken"/>
              </outline>
              <outline xmlUrl="https://known.test/feed" text="Known"/>
            </body></opml>
            """
        let report = await state.importOPML(Data(opml.utf8))
        #expect(report == ImportReport(imported: 1, alreadySubscribed: 1, failed: 1))
        #expect(state.toast?.message == "Imported 1 feed (1 already subscribed, 1 failed)")
        #expect(state.errorMessage == nil, "per-feed failures are in the report, not an alert")
        let sent = StubURLProtocol.requests(to: subscribe).compactMap { $0.body }.map { String(decoding: $0, as: UTF8.self) }
        #expect(sent.count == 2, "known feeds are not sent to the server")
        #expect(sent[0].contains(#""category":"Tech""#), "folders become categories")
        #expect(try db.enabledFeeds().map(\.url) == ["https://known.test/feed", "https://new.test/feed"])

        await state.importOPML(Data("<html/>".utf8))
        #expect(state.errorMessage?.hasPrefix("Could not import OPML") == true, "a bad file alerts")
        #expect(ImportReport(imported: 12, alreadySubscribed: 0, failed: 0).summary == "Imported 12 feeds")
        #expect(state.exportOPML().contains(#"xmlUrl="https://new.test/feed""#))
    }

    @Test func signedOutStateHasNoServerTraffic() async throws {
        let db = try AppDatabase.inMemory()
        let state = AppState(
            db: db, defaults: UserDefaults(suiteName: "SignedOutTests")!, session: stubbedSession([:]), tokenStore: MemoryTokenStore(),
            autostart: false)
        #expect(!state.isSignedIn)
        await state.refreshAll()
        await state.syncNow()
        #expect(state.errorMessage == nil, "nothing is attempted without an account")
    }
}
