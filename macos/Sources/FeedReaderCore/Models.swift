import Foundation
import GRDB

public struct Feed: Codable, Identifiable, Hashable, FetchableRecord, MutablePersistableRecord {
    public static let databaseTableName = "feeds"

    public var id: Int64?
    public var title: String
    public var url: String
    public var siteURL: String?
    public var category: String?
    public var enabled: Bool
    public var lastFetchedAt: Date?
    public var lastError: String?
    public var createdAt: Date
    /// Always load the post's web page instead of the feed content (for summary-only feeds).
    public var fullPage: Bool
    /// Server UUID when mirrored from the web API (nil in pure-local mode).
    public var remoteId: String?

    public init(
        id: Int64? = nil,
        title: String,
        url: String,
        siteURL: String? = nil,
        category: String? = nil,
        enabled: Bool = true,
        lastFetchedAt: Date? = nil,
        lastError: String? = nil,
        createdAt: Date = Date(),
        fullPage: Bool = false,
        remoteId: String? = nil
    ) {
        self.id = id
        self.title = title
        self.url = url
        self.siteURL = siteURL
        self.category = category
        self.enabled = enabled
        self.lastFetchedAt = lastFetchedAt
        self.lastError = lastError
        self.createdAt = createdAt
        self.fullPage = fullPage
        self.remoteId = remoteId
    }

    public mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }

    /// Newsletters arrive by e-mail: either ingested by the server (a `mailto:` address)
    /// or through a Kill the Newsletter inbox feed.
    public var isNewsletter: Bool {
        let lower = url.lowercased()
        return lower.hasPrefix("mailto:") || lower.hasPrefix("https://kill-the-newsletter.com/")
            || lower.hasPrefix("https://www.kill-the-newsletter.com/")
    }
}

public struct Item: Codable, Identifiable, Hashable, FetchableRecord, MutablePersistableRecord {
    public static let databaseTableName = "items"

    public var id: Int64?
    public var feedId: Int64
    public var guid: String
    public var link: String?
    public var title: String
    public var author: String?
    public var publishedAt: Date?
    public var contentHTML: String?
    public var contentText: String?
    public var readAt: Date?
    public var starred: Bool
    public var notes: String?
    public var createdAt: Date
    /// Server UUID when mirrored from the web API (nil in pure-local mode).
    public var remoteId: String?

    public var isRead: Bool { readAt != nil }

    public init(
        id: Int64? = nil,
        feedId: Int64,
        guid: String,
        link: String?,
        title: String,
        author: String?,
        publishedAt: Date?,
        contentHTML: String?,
        contentText: String?,
        readAt: Date? = nil,
        starred: Bool = false,
        notes: String? = nil,
        createdAt: Date = Date(),
        remoteId: String? = nil
    ) {
        self.id = id
        self.feedId = feedId
        self.guid = guid
        self.link = link
        self.title = title
        self.author = author
        self.publishedAt = publishedAt
        self.contentHTML = contentHTML
        self.contentText = contentText
        self.readAt = readAt
        self.starred = starred
        self.notes = notes
        self.createdAt = createdAt
        self.remoteId = remoteId
    }

    public mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }

    /// GRDB associations are immutable once built; the type just is not marked Sendable.
    nonisolated(unsafe) public static let feed = belongsTo(Feed.self)
}

public struct Tag: Codable, Hashable, FetchableRecord, PersistableRecord {
    public static let databaseTableName = "tags"
    public var itemId: Int64
    public var tag: String

    public init(itemId: Int64, tag: String) {
        self.itemId = itemId
        self.tag = tag
    }
}

/// Item joined with its feed title, for list display.
public struct ItemRow: Decodable, Identifiable, Hashable, FetchableRecord {
    public var item: Item
    public var feedTitle: String
    public var id: Int64 { item.id ?? 0 }

    public init(item: Item, feedTitle: String) {
        self.item = item
        self.feedTitle = feedTitle
    }
}
