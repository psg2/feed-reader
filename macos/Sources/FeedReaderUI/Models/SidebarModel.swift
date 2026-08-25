import Combine
import FeedReaderCore
import Foundation
import GRDB

/// Feeds with unread counts and the tag list. Observes the database; `reload()` restarts the observation.
@MainActor
public final class SidebarModel: ObservableObject {
    @Published public private(set) var feeds: [FeedWithCounts] = []
    @Published public private(set) var tags: [String] = []

    public var totalUnread: Int { feeds.reduce(0) { $0 + $1.unreadCount } }
    /// Web feeds and e-mail newsletters, for the two sidebar sections.
    public var webFeeds: [FeedWithCounts] { feeds.filter { !$0.feed.isNewsletter } }
    public var newsletters: [FeedWithCounts] { feeds.filter { $0.feed.isNewsletter } }

    private let db: AppDatabase
    private var feedsObserver: AnyDatabaseCancellable?
    private var tagsObserver: AnyDatabaseCancellable?

    public init(db: AppDatabase) {
        self.db = db
        reload()
    }

    public func reload() {
        feedsObserver =
            ValueObservation
            .tracking { @Sendable db in try AppDatabase.feedsWithCountsRequest().fetchAll(db) }
            .start(in: db.reader, scheduling: .immediate, onError: { _ in }) { [weak self] rows in self?.feeds = rows }
        tagsObserver =
            ValueObservation
            .tracking { @Sendable db in try String.fetchAll(db, sql: "SELECT DISTINCT tag FROM tags ORDER BY tag") }
            .start(in: db.reader, scheduling: .immediate, onError: { _ in }) { [weak self] tags in self?.tags = tags }
    }

    public func feedTitle(id: Int64) -> String? {
        feeds.first { $0.id == id }?.feed.title
    }
}
