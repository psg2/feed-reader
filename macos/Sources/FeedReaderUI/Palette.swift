import FeedReaderCore
import Foundation

/// One row of the ⌘K palette: an action or a navigation target.
public struct PaletteItem: Identifiable, Equatable {
    public enum Kind: Equatable { case action, feed, tag, post, search }
    public let id: String
    public let title: String
    public let subtitle: String?
    /// Shortcut label shown on the right, e.g. "⌘R" or "J".
    public let shortcut: String?
    public let kind: Kind
    public let section: String
    let perform: () -> Void

    public static func == (a: PaletteItem, b: PaletteItem) -> Bool { a.id == b.id }
}

public enum PaletteModel {
    /// Builds the full candidate list: available actions first, then feeds and tags to navigate to.
    @MainActor
    public static func items(actions: [AppAction], feeds: [FeedWithCounts], tags: [String], select: @escaping (ItemFilter) -> Void)
        -> [PaletteItem]
    {
        let a = actions.filter { $0.id != "palette" && $0.isAvailable() }.map { act in
            PaletteItem(
                id: "action:\(act.id)", title: act.title, subtitle: nil, shortcut: act.shortcut, kind: .action,
                section: act.section.rawValue, perform: act.perform)
        }
        let f = feeds.map { row in
            PaletteItem(
                id: "feed:\(row.id)", title: row.feed.title,
                subtitle: row.unreadCount > 0 ? "\(row.unreadCount) unread" : nil,
                shortcut: nil, kind: .feed, section: "Feeds"
            ) { select(.feed(row.id)) }
        }
        let t = tags.map { tag in
            PaletteItem(id: "tag:\(tag)", title: tag, subtitle: nil, shortcut: nil, kind: .tag, section: "Tags") { select(.tag(tag)) }
        }
        return a + f + t
    }

    /// Notion-style: posts matching the query, plus a "Search posts" row that applies the query to the list.
    /// Empty when the query is blank. Appended after the filtered actions/feeds/tags.
    @MainActor
    public static func searchItems(query: String, db: AppDatabase, open: @escaping (Int64) -> Void, search: @escaping (String) -> Void)
        -> [PaletteItem]
    {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { return [] }
        let posts = ((try? db.searchItems(q)) ?? []).map { row in
            PaletteItem(id: "post:\(row.id)", title: row.item.title, subtitle: row.feedTitle, shortcut: nil, kind: .post, section: "Posts")
            { open(row.id) }
        }
        let all = PaletteItem(id: "search", title: "Search posts for “\(q)”", subtitle: nil, shortcut: "/", kind: .search, section: "Posts")
        { search(q) }
        return posts + [all]
    }

    /// Case-insensitive match: every whitespace-separated word of the query must appear in the title
    /// (or section), in any order. Empty query keeps everything. Results preserve the input order.
    public static func filter(_ items: [PaletteItem], query: String) -> [PaletteItem] {
        let words = query.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
        guard !words.isEmpty else { return items }
        return items.filter { item in
            let hay = (item.title + " " + item.section).lowercased()
            return words.allSatisfy { hay.contains($0) }
        }
    }
}
