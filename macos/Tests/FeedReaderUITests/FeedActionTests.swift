import FeedReaderCore
import Foundation
import Testing

@testable import FeedReaderUI

@MainActor
struct FeedActionTests {
    @Test func unsubscribeDialogCountsPostsAndNotesFromTheMirror() throws {
        let (db, feed, ids) = try ModelTests.seeded()
        try db.setNotes(itemId: ids[0], notes: "keep this")
        let state = AppState(db: db, defaults: UserDefaults(suiteName: "FeedActionTests")!, autostart: false)
        let dialog = state.unsubscribeDialog(for: feed)
        #expect(dialog.title == "Unsubscribe from “Blog”?")
        #expect(dialog.posts == 3)
        #expect(dialog.withNotes == 1)
        #expect(dialog.message == "Its 3 posts, including 1 with notes, will be deleted everywhere. To keep them, pause the feed instead.")
    }

    @Test func unsubscribeDialogWordingWithoutNotesAndForOnePost() {
        #expect(
            UnsubscribeDialog(feedTitle: "A", posts: 12, withNotes: 0).message
                == "Its 12 posts will be deleted everywhere. To keep them, pause the feed instead.")
        #expect(UnsubscribeDialog(feedTitle: "A", posts: 1, withNotes: 0).message.hasPrefix("Its 1 post will"))
    }

    @Test func pauseUpdatesTheMirrorAndQueuesTheServerWrite() throws {
        let db = try AppDatabase.inMemory()
        let feed = try db.addFeed(Feed(title: "A", url: "https://a.test/feed", remoteId: "F1"))
        let state = AppState(db: db, defaults: UserDefaults(suiteName: "FeedActionTests-pause")!, autostart: false)
        state.setEnabled(feedId: feed.id!, false)
        #expect(try db.feed(id: feed.id!)?.enabled == false)
        #expect(try db.pendingOps().map(\.op) == [.setEnabled(feedId: "F1", enabled: false)])
        state.setEnabled(feedId: feed.id!, true)
        #expect(try db.pendingOps().map(\.op) == [.setEnabled(feedId: "F1", enabled: true)], "resume replaces the queued pause")
    }
}
