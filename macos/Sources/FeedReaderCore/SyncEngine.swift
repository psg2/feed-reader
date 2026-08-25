import Foundation
import GRDB

/// Pulls the server's full dump into the local SQLite mirror.
///
/// Server-mirror mode: the web server is the source of truth. `pull` upserts
/// feeds/items by their server UUID (`remoteId`), overwrites local state
/// (read/starred/notes/tags) with the server's, and removes mirrored
/// rows the server no longer has. Rows without a `remoteId` (pure-local data)
/// are never touched, so a local-mode database survives an accidental pull.
/// Writes still queued in `pending_ops` are replayed on top, so a pull never
/// reverts a change the server has not received yet.
public enum SyncEngine {
    public struct PullSummary: Equatable, Sendable {
        public var feeds: Int
        public var items: Int
        public var removedFeeds: Int
        public var removedItems: Int
    }

    /// Fetches the dump and applies it, then replays what the dump cannot contain: ops pushed while the request
    /// was in flight (`beginPull`/`finishPull`) and ops still queued.
    @discardableResult
    public static func pull(api: RemoteAPI, db: AppDatabase) async throws -> PullSummary {
        let marker = db.beginPull()
        let summary: PullSummary
        do {
            summary = try await apply(try await api.sync(), db: db)
        } catch {
            db.endPull(since: marker)
            throw error
        }
        try db.finishPull(since: marker)
        return summary
    }

    /// Applies a dump inside one transaction. Split from `pull` for tests.
    @discardableResult
    public static func apply(_ dump: RemoteAPI.SyncDump, db: AppDatabase) async throws -> PullSummary {
        try await db.writer.write { sqlite in
            var summary = PullSummary(feeds: 0, items: 0, removedFeeds: 0, removedItems: 0)

            // ── Feeds ────────────────────────────────────────────────────
            var feedIdByRemote: [String: Int64] = [:]
            for remote in dump.feeds {
                let existing =
                    try Feed.filter(Column("remoteId") == remote.id).fetchOne(sqlite)
                    ?? Feed.filter(Column("url") == remote.url).fetchOne(sqlite)
                var feed = existing ?? Feed(title: remote.title, url: remote.url)
                feed.title = remote.title
                feed.url = remote.url
                feed.siteURL = remote.siteUrl
                feed.category = remote.category
                feed.enabled = remote.enabled
                feed.fullPage = remote.fullPage
                feed.lastFetchedAt = RemoteAPI.date(remote.lastFetchedAt)
                feed.lastError = remote.lastError
                feed.remoteId = remote.id
                if existing == nil {
                    feed = try feed.insertAndFetch(sqlite)!
                } else {
                    try feed.update(sqlite)
                }
                if let id = feed.id { feedIdByRemote[remote.id] = id }
                summary.feeds += 1
            }
            // Mirrored feeds the server no longer has (cascades to their items).
            let keptFeedIds = dump.feeds.map(\.id)
            summary.removedFeeds =
                try Feed
                .filter(Column("remoteId") != nil && !keptFeedIds.contains(Column("remoteId")))
                .deleteAll(sqlite)

            // ── Items ────────────────────────────────────────────────────
            for remote in dump.items {
                guard let feedId = feedIdByRemote[remote.feedId] else { continue }
                let existing =
                    try Item.filter(Column("remoteId") == remote.id).fetchOne(sqlite)
                    ?? Item.filter(Column("feedId") == feedId && Column("guid") == remote.guid).fetchOne(sqlite)
                var item =
                    existing
                    ?? Item(
                        feedId: feedId, guid: remote.guid, link: remote.link, title: remote.title,
                        author: remote.author, publishedAt: nil, contentHTML: nil, contentText: nil)
                item.feedId = feedId
                item.guid = remote.guid
                item.link = remote.link
                item.title = remote.title
                item.author = remote.author
                item.publishedAt = RemoteAPI.date(remote.publishedAt)
                item.contentHTML = remote.contentHtml
                item.contentText = remote.contentText
                item.readAt = RemoteAPI.date(remote.readAt)
                item.starred = remote.starred
                item.notes = remote.notes
                item.remoteId = remote.id
                let itemId: Int64
                if existing == nil {
                    itemId = try item.insertAndFetch(sqlite)!.id!
                } else {
                    try item.update(sqlite)
                    itemId = item.id!
                }
                summary.items += 1

                // Tags: replace with the server's set.
                try Tag.filter(Column("itemId") == itemId).deleteAll(sqlite)
                for tag in remote.tags {
                    try Tag(itemId: itemId, tag: tag).insert(sqlite)
                }
            }
            // Mirrored items the server no longer has.
            let keptItemIds = dump.items.map(\.id)
            summary.removedItems =
                try Item
                .filter(Column("remoteId") != nil && !keptItemIds.contains(Column("remoteId")))
                .deleteAll(sqlite)

            return summary
        }
    }
}
