import FeedReaderCore
import Foundation
import TestSupport
import Testing

@testable import FeedReaderUI

struct TagTextTests {
    @Test func parseTrimsLowercasesAndDedupes() {
        #expect(TagText.parse(" Swift, llm ,,SWIFT, ai\n") == ["swift", "llm", "ai"])
        #expect(TagText.parse("") == [])
        #expect(TagText.join(["a", "b"]) == "a, b")
        #expect(TagText.parse(TagText.join(["swift", "ai"])) == ["swift", "ai"], "round trip")
    }

    @Test func suggestionsMatchPrefixAndSkipChosenTags() {
        let all = ["agents", "ai", "apple", "swift"]
        #expect(TagText.suggestions(for: "a", among: all, excluding: ["ai"]) == ["agents", "apple"])
        #expect(TagText.suggestions(for: " AP ", among: all, excluding: []) == ["apple"])
        #expect(TagText.suggestions(for: "", among: all, excluding: []).isEmpty)
        #expect(TagText.suggestions(for: "a", among: all, excluding: [], limit: 1) == ["agents"])
    }
}

@MainActor
struct SaveStatusTests {
    @Test func statusFollowsTheQueue() {
        let queued = try! PendingOp(op: .setNotes(itemId: "I1", notes: "x"))
        var failed = queued
        failed.attempts = 2
        #expect(SaveStatus.from(pending: [], previous: nil) == nil, "nothing edited yet")
        #expect(SaveStatus.from(pending: [queued], previous: nil) == .saving)
        #expect(SaveStatus.from(pending: [failed], previous: .saving) == .queuedOffline)
        #expect(SaveStatus.from(pending: [], previous: .queuedOffline) == .saved)
        #expect(SaveStatus.from(pending: [queued], previous: .failed("no")) == .failed("no"), "a refusal sticks until Retry")
        #expect(SaveStatus.queuedOffline.text == "Saved on this Mac · syncing later")
    }

    @Test func localOnlySavesReportSavedThenFade() async throws {
        let (db, _, ids) = try ModelTests.seeded()
        let detail = ItemDetailModel(db: db, itemId: ids[0], debounceMs: 10)
        #expect(detail.saveStatus == nil)
        detail.notes = "hi"
        for _ in 0..<100 where detail.saveStatus != .saved { try await Task.sleep(for: .milliseconds(10)) }
        #expect(detail.saveStatus == .saved)
    }

    @Test func offlineEditShowsSavedOnThisMacAndServerRefusalShowsRetry() async throws {
        let host = "notes-offline.test"
        let updateItem = "https://\(host)/api/rpc/reader/updateItem"
        StubURLProtocol.stub(updateItem, [.offline()])
        let db = try AppDatabase.inMemory()
        let itemId = try await db.writer.write { sqlite -> Int64 in
            var feed = Feed(title: "A", url: "https://a.test/feed", remoteId: "F1")
            feed = try feed.insertAndFetch(sqlite)!
            var item = Item(
                feedId: feed.id!, guid: "I1", link: nil, title: "I1", author: nil, publishedAt: nil, contentHTML: nil, contentText: nil,
                remoteId: "I1")
            try item.insert(sqlite)
            return item.id!
        }
        let defaults = UserDefaults(suiteName: "SaveStatusTests")!
        defaults.set("https://\(host)", forKey: "remoteServerURL")
        let tokens = MemoryTokenStore(OAuthTokens(accessToken: "at", refreshToken: "rt", expiresAt: .distantFuture))
        let state = AppState(db: db, defaults: defaults, session: stubbedSession(), tokenStore: tokens, autostart: false)
        let detail = ItemDetailModel(db: db, itemId: itemId, debounceMs: 10, push: { [weak state] in state?.enqueue($0) })
        state.activeDetail = detail

        detail.notes = "offline note"
        for _ in 0..<100 where state.pendingCount == 0 { try await Task.sleep(for: .milliseconds(10)) }
        await state.retryNow()
        for _ in 0..<100 where detail.saveStatus != .queuedOffline { try await Task.sleep(for: .milliseconds(10)) }
        #expect(detail.saveStatus == .queuedOffline)
        #expect(try db.item(id: itemId)?.notes == "offline note", "the mirror has it regardless")

        StubURLProtocol.stub(updateItem, [.init(status: 400, body: Data(#"{"json":{"code":"BAD_REQUEST","message":"too long"}}"#.utf8))])
        await state.retryNow()
        #expect(detail.saveStatus == .failed("BAD_REQUEST: too long"))
        #expect(state.errorMessage == nil, "no alert for a background push")

        StubURLProtocol.stub([updateItem: Data(#"{"json":{"id":"I1"}}"#.utf8)])
        detail.retrySave()
        for _ in 0..<100 where detail.saveStatus != .saved { try await Task.sleep(for: .milliseconds(10)) }
        #expect(detail.saveStatus == .saved)
    }
}
