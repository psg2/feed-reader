import FeedReaderCore
import Foundation

/// What the "Unsubscribe" confirmation says, from the local mirror's counts.
public struct UnsubscribeDialog: Equatable, Sendable {
    public let feedTitle: String
    public let posts: Int
    public let withNotes: Int

    public init(feedTitle: String, posts: Int, withNotes: Int) {
        self.feedTitle = feedTitle
        self.posts = posts
        self.withNotes = withNotes
    }

    public var title: String { "Unsubscribe from “\(feedTitle)”?" }

    public var message: String {
        let n = posts == 1 ? "Its 1 post" : "Its \(posts) posts"
        let m = withNotes > 0 ? ", including \(withNotes) with notes," : ""
        return "\(n)\(m) will be deleted everywhere. To keep them, pause the feed instead."
    }
}

extension AppState {
    public func unsubscribeDialog(for feed: Feed) -> UnsubscribeDialog {
        let counts = feed.id.flatMap { try? db.feedCounts(feedId: $0) } ?? (posts: 0, withNotes: 0)
        return UnsubscribeDialog(feedTitle: feed.title, posts: counts.posts, withNotes: counts.withNotes)
    }
}
