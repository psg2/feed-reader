import FeedReaderCore
import Foundation
import Testing

@testable import FeedReaderUI

struct StatusTextTests {
    @Test func footerLinePrefersFailureThenPendingThenLastUpdate() {
        let now = Date()
        #expect(
            SyncStatusLine.make(lastSync: nil, now: now, pending: 0, failed: false)
                == SyncStatusLine(text: "Not updated yet", showsRetry: false))
        #expect(
            SyncStatusLine.make(lastSync: now.addingTimeInterval(-3600), now: now, pending: 0, failed: false)
                == SyncStatusLine(text: "Updated 1h ago", showsRetry: false))
        #expect(
            SyncStatusLine.make(lastSync: now, now: now, pending: 3, failed: false)
                == SyncStatusLine(text: "3 changes pending", showsRetry: true)
        )
        #expect(SyncStatusLine.make(lastSync: now, now: now, pending: 1, failed: false).text == "1 change pending")
        #expect(
            SyncStatusLine.make(lastSync: now, now: now, pending: 3, failed: true)
                == SyncStatusLine(text: "Couldn’t sync", showsRetry: true))
    }

    @Test func emptyListCopyDependsOnViewAndSearch() {
        #expect(EmptyListText.title(filter: .unread, search: "") == "Inbox zero. Go outside.")
        #expect(EmptyListText.title(filter: .all, search: "") == "Nothing here")
        #expect(EmptyListText.title(filter: .starred, search: " ") == "Nothing here")
        #expect(EmptyListText.title(filter: .unread, search: "rust") == "No posts match “rust”")
    }
}
