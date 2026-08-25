import FeedReaderCore
import Foundation
import Testing

@testable import FeedReaderUI

@MainActor
struct PaletteTests {
    func make() throws -> (AppState, ItemListModel, SidebarModel, [Int64]) {
        let (db, _, ids) = try ModelTests.seeded()
        try db.setTags(itemId: ids[0], tags: ["swift"])
        let state = AppState(db: db, defaults: UserDefaults(suiteName: "PaletteTests")!, autostart: false)
        let list = ItemListModel(db: db, filter: .all)
        state.installActions(list: list)
        return (state, list, SidebarModel(db: db), ids)
    }

    @Test func listsActionsFeedsAndTags() throws {
        let (state, list, sidebar, _) = try make(); _ = list
        var picked: ItemFilter?
        let items = PaletteModel.items(actions: state.actions, feeds: sidebar.feeds, tags: ["swift"]) { picked = $0 }
        #expect(!items.contains { $0.id == "action:palette" }, "palette does not list itself")
        #expect(!items.contains { $0.id == "action:read" }, "unavailable actions (no selection) are hidden")
        #expect(items.contains { $0.id == "action:refresh" && $0.shortcut == "R" })
        let feed = items.first { $0.kind == .feed }
        #expect(feed?.title == "Blog" && feed?.subtitle == "2 unread")
        feed?.perform()
        #expect(picked == .feed(sidebar.feeds[0].id))
        items.first { $0.kind == .tag }?.perform()
        #expect(picked == .tag("swift"))
    }

    @Test func filterMatchesWordsInAnyOrder() throws {
        let (state, list, sidebar, _) = try make(); _ = list
        let items = PaletteModel.items(actions: state.actions, feeds: sidebar.feeds, tags: ["swift"]) { _ in }
        #expect(PaletteModel.filter(items, query: "").count == items.count)
        #expect(PaletteModel.filter(items, query: "read all").map(\.id) == ["action:markAll"])
        #expect(PaletteModel.filter(items, query: "BLOG").map(\.kind) == [.feed])
        #expect(PaletteModel.filter(items, query: "feeds").map(\.id).contains("feed:1"), "section name is searchable")
        #expect(PaletteModel.filter(items, query: "zzz").isEmpty)
    }

    @Test func searchRowsListMatchingPostsAndASearchAllRow() throws {
        let (state, list, _, ids) = try make(); _ = list
        var opened: Int64?; var searched: String?
        #expect(PaletteModel.searchItems(query: "n", db: state.db, open: { _ in }, search: { _ in }).isEmpty, "needs 2+ characters")
        let rows = PaletteModel.searchItems(query: "newest", db: state.db, open: { opened = $0 }, search: { searched = $0 })
        #expect(rows.map(\.kind) == [.post, .search])
        #expect(rows[0].title == "Newest" && rows[0].subtitle == "Blog")
        rows[0].perform(); #expect(opened == ids[0])
        rows[1].perform(); #expect(searched == "newest")
    }
}
