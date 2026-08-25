import AppKit
import FeedReaderCore
import SnapshotTesting
import SwiftUI
import Testing

@testable import FeedReaderUI

@MainActor
struct SnapshotTests {
    @Test func itemRow() throws {
        let (db, _, _) = try Snap.fixtureDB()
        let rows = try db.reader.read { db in try AppDatabase.itemsRequest(filter: .all).fetchAll(db) }
        let view = VStack(spacing: 0) {
            ForEach(rows) { ItemRowView(row: $0, showFeedTitle: true, now: Snap.epoch.addingTimeInterval(3600)).padding(.horizontal, 8) }
        }
        .frame(width: 360)
        .background(Color(nsColor: .windowBackgroundColor))
        Snap.assert(view, size: CGSize(width: 360, height: 260), name: "rows")
    }

    @Test func detailHeader() throws {
        let (db, feed, ids) = try Snap.fixtureDB()
        let state = AppState(db: db, autostart: false)
        let item = try db.item(id: ids[0])!
        let view = DetailHeader(item: item, feedTitle: feed.title, now: Snap.epoch.addingTimeInterval(3600))
            .environmentObject(state)
            .background(Color(nsColor: .windowBackgroundColor))
        Snap.assert(view, size: CGSize(width: 600, height: 80), name: "header")
    }

    @Test func sidebar() throws {
        let (db, _, ids) = try Snap.fixtureDB()
        try db.setTags(itemId: ids[0], tags: ["agents", "code-review"])
        let state = AppState(db: db, autostart: false)
        // The sidebar's vibrancy material depends on the machine (wallpaper, transparency settings),
        // so the snapshot replaces it with a flat window background.
        let view = SidebarView(model: SidebarModel(db: db))
            .environmentObject(state)
            .scrollContentBackground(.hidden)
            .background(Color(nsColor: .windowBackgroundColor))
        Snap.assert(view, size: CGSize(width: 240, height: 360), name: "sidebar")
    }

    @Test func sidebarWithPausedFeedAndNewsletter() throws {
        let (db, feed, _) = try Snap.fixtureDB()
        try db.setEnabled(feedId: feed.id!, false)
        try db.addFeed(Feed(title: "Money Stuff", url: "mailto:money@newsletters.test", createdAt: Snap.epoch))
        let state = AppState(db: db, autostart: false)
        let view = SidebarView(model: SidebarModel(db: db))
            .environmentObject(state)
            .scrollContentBackground(.hidden)
            .background(Color(nsColor: .windowBackgroundColor))
        Snap.assert(view, size: CGSize(width: 240, height: 360), name: "sidebar-paused-newsletter")
    }

    @Test func firstRun() throws {
        let db = try AppDatabase.inMemory()
        let state = AppState(db: db, autostart: false)
        let view = FirstRunView().environmentObject(state).background(Color(nsColor: .windowBackgroundColor))
        Snap.assert(view, size: CGSize(width: 360, height: 300), name: "first-run")
    }

    @Test func tagChips() throws {
        let view = VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("Notes").font(.headline)
                Text(SaveStatus.queuedOffline.text).font(.caption).foregroundStyle(.secondary)
            }
            TagChipField(tags: .constant(["agents", "code-review", "swift"]), suggestions: ["ai"])
        }
        .padding(12)
        .frame(width: 320)
        .background(Color(nsColor: .windowBackgroundColor))
        Snap.assert(view, size: CGSize(width: 320, height: 90), name: "chips")
    }

    @Test func palette() throws {
        let (db, _, ids) = try Snap.fixtureDB()
        try db.setTags(itemId: ids[0], tags: ["agents"])
        let state = AppState(db: db, autostart: false)
        let list = ItemListModel(db: db, filter: .all)
        state.installActions(list: list)
        let view = PaletteView(sidebar: SidebarModel(db: db))
            .environmentObject(state)
            .background(Color(nsColor: .windowBackgroundColor))
        withExtendedLifetime(list) { Snap.assert(view, size: CGSize(width: 520, height: 380), name: "palette") }
    }
}
