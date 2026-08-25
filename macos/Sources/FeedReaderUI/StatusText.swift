import FeedReaderCore
import Foundation

/// The sidebar footer's one-line sync status.
public struct SyncStatusLine: Equatable, Sendable {
    public let text: String
    /// Show an inline "Retry" after the text.
    public let showsRetry: Bool

    /// Failure wins, then queued changes, then the last successful update.
    public static func make(lastSync: Date?, now: Date, pending: Int, failed: Bool) -> SyncStatusLine {
        if failed { return SyncStatusLine(text: "Couldn’t sync", showsRetry: true) }
        if pending > 0 { return SyncStatusLine(text: "\(pending) change\(pending == 1 ? "" : "s") pending", showsRetry: true) }
        guard let lastSync else { return SyncStatusLine(text: "Not updated yet", showsRetry: false) }
        return SyncStatusLine(text: "Updated \(RelativeText.string(from: lastSync, now: now))", showsRetry: false)
    }
}

/// What the list says when it has no rows.
public enum EmptyListText {
    public static func title(filter: ItemFilter, search: String) -> String {
        let q = search.trimmingCharacters(in: .whitespaces)
        if !q.isEmpty { return "No posts match “\(q)”" }
        if filter == .unread { return "Inbox zero. Go outside." }
        return "Nothing here"
    }
}
