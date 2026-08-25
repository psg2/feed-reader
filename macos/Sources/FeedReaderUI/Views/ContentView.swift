import FeedReaderCore
import SwiftUI

public struct ContentView: View {
    @EnvironmentObject var state: AppState
    @StateObject private var sidebar: SidebarModel
    @StateObject private var list: ItemListModel
    @State private var palette = PalettePanel()

    public init(state: AppState) {
        _sidebar = StateObject(wrappedValue: SidebarModel(db: state.db))
        _list = StateObject(wrappedValue: ItemListModel(db: state.db, filter: state.filter, search: state.search))
    }

    public var body: some View {
        NavigationSplitView {
            SidebarView(model: sidebar)
        } content: {
            ItemListView(model: list, hasFeeds: !sidebar.feeds.isEmpty)
        } detail: {
            if let id = state.selectedItemId {
                ItemDetailView(model: ItemDetailModel(db: state.db, itemId: id, push: { [weak state] in state?.enqueue($0) }))
                    .id(id)
            } else {
                ContentUnavailableView("Select a post", systemImage: "doc.text")
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    state.showAddFeed = true
                } label: {
                    Label("Add Feed", systemImage: "plus")
                }
                .help("Add feed (A)")
                Button {
                    state.markAllRead()
                } label: {
                    Label("Mark All Read", systemImage: "checkmark.circle")
                }
                .help("Mark all as read (⇧⌘K)")
                Button {
                    Task { await state.refreshAll() }
                } label: {
                    if state.isRefreshing { ProgressView().controlSize(.small) } else { Label("Refresh", systemImage: "arrow.clockwise") }
                }
                .disabled(state.isRefreshing)
                .help("Refresh (R)")
            }
        }
        .sheet(isPresented: $state.showAddFeed) { AddFeedSheet() }
        .sheet(isPresented: $state.showShortcuts) { ShortcutsSheet(actions: state.actions) }
        .alert("Error", isPresented: Binding(get: { state.errorMessage != nil }, set: { if !$0 { state.errorMessage = nil } })) {
            Button("OK") { state.errorMessage = nil }
        } message: {
            Text(state.errorMessage ?? "")
        }
        .onChange(of: state.filter) { _, f in list.update(filter: f, search: state.search) }
        .onChange(of: state.search) { _, s in list.update(filter: state.filter, search: s) }
        .onChange(of: state.selectedItemId) { _, id in list.selectedItemId = id }
        .onChange(of: state.reloadToken) { _, _ in
            sidebar.reload(); list.reload()
        }
        .onAppear { state.installActions(list: list) }
        .onChange(of: state.showShortcuts) { _, on in if on { state.markShortcutsDiscovered() } }
        .onChange(of: state.showPalette) { _, on in
            if on {
                state.markShortcutsDiscovered()
                if let window = NSApp.keyWindow ?? NSApp.mainWindow {
                    palette.show(PaletteView(sidebar: sidebar).environmentObject(state), over: window) { [weak state] in
                        state?.showPalette = false
                    }
                }
            } else {
                palette.hide()
            }
        }
    }
}

// MARK: - Sidebar

struct SidebarView: View {
    @EnvironmentObject var state: AppState
    @ObservedObject var model: SidebarModel
    @State private var unsubscribing: FeedWithCounts?

    var body: some View {
        List(selection: Binding(get: { state.filter }, set: { if let f = $0 { state.filter = f } })) {
            Section {
                Label("Unread", systemImage: "circle.fill").badge(model.totalUnread).tag(ItemFilter.unread)
                Label("All", systemImage: "tray.full").tag(ItemFilter.all)
                Label("Starred", systemImage: "star").tag(ItemFilter.starred)
            }
            Section("Feeds") {
                if model.feeds.isEmpty {
                    Button("Add Feed…") { state.showAddFeed = true }.buttonStyle(.link)
                }
                ForEach(model.webFeeds) { row in feedRow(row) }
            }
            if !model.newsletters.isEmpty {
                Section("Newsletters") {
                    ForEach(model.newsletters) { row in feedRow(row) }
                }
            }
            if !model.tags.isEmpty {
                Section("Tags") {
                    ForEach(model.tags, id: \.self) { tag in
                        Label(tag, systemImage: "tag").tag(ItemFilter.tag(tag))
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 200, ideal: 240)
        .safeAreaInset(edge: .bottom) {
            AccountFooter()
        }
        .confirmationDialog(
            unsubscribing.map { state.unsubscribeDialog(for: $0.feed).title } ?? "",
            isPresented: Binding(
                get: { unsubscribing != nil }, set: { if !$0 { unsubscribing = nil } }),
            titleVisibility: .visible, presenting: unsubscribing
        ) { row in
            Button("Unsubscribe", role: .destructive) { state.delete(feed: row.feed) }
            Button("Pause") { state.setEnabled(feedId: row.id, false) }
            Button("Cancel", role: .cancel) {}
        } message: { row in
            Text(state.unsubscribeDialog(for: row.feed).message)
        }
    }

    private func feedRow(_ row: FeedWithCounts) -> some View {
        Label {
            HStack {
                Text(row.feed.title)
                if !row.feed.enabled {
                    Image(systemName: "pause.circle").foregroundStyle(.secondary).help("Paused")
                }
                if row.feed.lastError != nil {
                    Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange)
                        .help("Couldn't fetch this feed on the last refresh: \(row.feed.lastError ?? "")")
                }
            }
        } icon: {
            FeedIcon(feed: row.feed)
        }
        .opacity(row.feed.enabled ? 1 : 0.5)
        .badge(row.unreadCount)
        .tag(ItemFilter.feed(row.id))
        .contextMenu {
            Button("Mark Feed as Read") { state.markAllRead(feedId: row.id) }
            Toggle(
                "Always Load Full Page",
                isOn: Binding(
                    get: { row.feed.fullPage },
                    set: { state.setFullPage(feedId: row.id, $0) }))
            if let site = row.feed.siteURL, let url = URL(string: site) {
                Button("Open Site") { NSWorkspace.shared.open(url) }
            }
            Button("Copy Feed URL") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(row.feed.url, forType: .string)
            }
            Divider()
            Button(row.feed.enabled ? "Pause" : "Resume") { state.setEnabled(feedId: row.id, !row.feed.enabled) }
            Button("Unsubscribe…", role: .destructive) { unsubscribing = row }
        }
    }
}

/// The glyph for a feed: an envelope for newsletters (`mailto:` feeds), the feed symbol otherwise.
struct FeedIcon: View {
    let feed: Feed
    var body: some View { Image(systemName: feed.isNewsletter ? "envelope" : "dot.radiowaves.up.forward") }
}

/// Who is signed in and when we last talked to the server, with the account actions behind a ⋯ button.
struct AccountFooter: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        HStack(spacing: 8) {
            Avatar(profile: state.profile)
            VStack(alignment: .leading, spacing: 1) {
                Text(state.profile?.name ?? "Signed in").font(.callout).lineLimit(1)
                TimelineView(.periodic(from: .now, by: 30)) { ctx in
                    let line = SyncStatusLine.make(
                        lastSync: state.lastSync, now: ctx.date, pending: state.pendingCount, failed: state.syncError != nil)
                    HStack(spacing: 4) {
                        Text(line.text).lineLimit(1)
                        if line.showsRetry {
                            Text("·")
                            Button("Retry") { Task { await state.retryNow() } }.buttonStyle(.link).help("Retry now")
                        }
                    }
                    .font(.caption2).foregroundStyle(.secondary)
                    .help(state.syncError ?? "")
                }
            }
            Spacer(minLength: 4)
            if state.isRefreshing { ProgressView().controlSize(.mini) }
            Menu {
                if let profile = state.profile {
                    Text(profile.email)
                    Divider()
                }
                Button("Refresh") { Task { await state.refreshAll() } }.disabled(state.isRefreshing)
                Button("Open on the Web") { NSWorkspace.shared.open(state.serverURL.appendingPathComponent("reader")) }
                Divider()
                Button("Settings…") { NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil) }
                Button("Sign Out…") { Task { await state.signOut() } }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Account")
            .accessibilityLabel("Account")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
    }
}

/// Google/profile picture when there is one; the system person glyph otherwise.
struct Avatar: View {
    let profile: Profile?

    var body: some View {
        Group {
            if let picture = profile?.picture, let url = URL(string: picture) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    placeholder
                }
            } else {
                placeholder
            }
        }
        .frame(width: 28, height: 28)
        .clipShape(Circle())
    }

    private var placeholder: some View {
        Image(systemName: "person.crop.circle.fill")
            .resizable()
            .symbolRenderingMode(.hierarchical)
            .foregroundStyle(.secondary)
    }
}

// MARK: - Item list

struct ItemListView: View {
    @EnvironmentObject var state: AppState
    @ObservedObject var model: ItemListModel
    /// False when the mirror has no feeds: after the first pull that is the first-run screen; before it
    /// (a returning user's initial pull) the list shows a spinner instead of flashing "Add your first feed".
    var hasFeeds = true
    @FocusState private var listFocused: Bool
    @FocusState private var searchFocused: Bool

    var body: some View {
        List(model.rows, selection: $state.selectedItemId) { row in
            ItemRowView(row: row, showFeedTitle: showFeedTitle, now: state.now())
                .tag(row.id)
                .contextMenu {
                    Button(row.item.isRead ? "Mark as Unread" : "Mark as Read") { state.markRead(row.id, read: !row.item.isRead) }
                    Button(row.item.starred ? "Unstar" : "Star") { state.toggleStar(row.id, current: row.item.starred) }
                    if let link = row.item.link, let url = URL(string: link) {
                        Button("Open in Browser") { NSWorkspace.shared.open(url) }
                    }
                }
        }
        .focused($listFocused)
        .searchable(text: $state.search, placement: .toolbar, prompt: "Search title, content, notes")
        .searchFocused($searchFocused)
        .onChange(of: state.focusRequest.1) { _, _ in
            switch state.focusRequest.0 {
            case .search: searchFocused = true
            case .list: searchFocused = false; listFocused = true
            case .notes: break
            }
        }
        .navigationSplitViewColumnWidth(min: 280, ideal: 360)
        .navigationTitle(title)
        .overlay {
            if !hasFeeds {
                if state.lastSync != nil && !state.isRefreshing || state.syncError != nil {
                    FirstRunView()
                } else {
                    ProgressView("Loading your feeds…")
                }
            } else if model.rows.isEmpty {
                ContentUnavailableView(
                    EmptyListText.title(filter: model.filter, search: model.search),
                    systemImage: model.search.isEmpty ? "checkmark.circle" : "magnifyingglass")
            }
        }
        .onChange(of: model.error) { _, e in if let e { state.errorMessage = e } }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !state.hintDismissed {
                HintBar(dismiss: { state.markShortcutsDiscovered() })
            }
        }
        .overlay(alignment: .bottom) {
            if let toast = state.toast {
                ToastView(toast: toast, undo: { state.undoFromToast() }, dismiss: { state.dismissToast() })
                    .padding(12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.2), value: state.toast)
    }

    private var showFeedTitle: Bool {
        if case .feed = model.filter { return false }
        return true
    }

    private var title: String {
        switch model.filter {
        case .all: return "All"
        case .unread: return "Unread"
        case .starred: return "Starred"
        case .feed(let id): return (try? state.db.feed(id: id)?.title) ?? "Feed"
        case .tag(let t): return "#\(t)"
        }
    }
}

/// No feeds yet: the two ways in.
struct FirstRunView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        ContentUnavailableView {
            Label("Add your first feed", systemImage: "dot.radiowaves.up.forward")
        } description: {
            Text("Paste a feed or site URL, or import an OPML file from another reader.")
        } actions: {
            HStack {
                Button("Add Feed…") { state.showAddFeed = true }.keyboardShortcut(.defaultAction)
                Button("Import OPML…") { state.presentImportOPML() }
            }
        }
    }
}

struct HintBar: View {
    var dismiss: () -> Void
    var body: some View {
        HStack(spacing: 10) {
            Group {
                key("J", "K"); Text("navigate")
                key("E"); Text("read & next")
                key("A"); Text("add feed")
                key("⌘K"); Text("commands")
                key("?"); Text("shortcuts")
            }
            Spacer()
            Button(action: dismiss) { Image(systemName: "xmark").font(.caption2) }
                .buttonStyle(.plain).help("Hide hints").accessibilityLabel("Hide hints")
        }
        .font(.caption).foregroundStyle(.secondary)
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }

    private func key(_ keys: String...) -> some View {
        HStack(spacing: 2) {
            ForEach(keys, id: \.self) { k in
                Text(k).font(.caption2.monospaced())
                    .padding(.horizontal, 4).padding(.vertical, 1)
                    .background(RoundedRectangle(cornerRadius: 3).fill(.quaternary))
            }
        }
    }
}

struct ShortcutsSheet: View {
    @Environment(\.dismiss) var dismiss
    let actions: [AppAction]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Keyboard shortcuts").font(.headline)
            HStack(alignment: .top, spacing: 28) {
                ForEach(AppAction.Section.allCases, id: \.self) { section in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(section.rawValue).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        ForEach(actions.filter { $0.section == section }) { a in
                            HStack {
                                Text(a.title)
                                Spacer(minLength: 16)
                                Text(a.shortcut).font(.callout.monospaced()).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .frame(width: 220, alignment: .leading)
                }
            }
            Text(
                "Single letters work whenever you are not typing in a text field. Menu bar: ⌘R refresh, ⌘N add feed, ⌘U/⌘D/⇧⌘O on the post."
            )
            .font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
    }
}

struct ToastView: View {
    let toast: Toast
    var undo: () -> Void
    var dismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text(toast.message).font(.callout)
            if toast.undoable {
                Button("Undo", action: undo).buttonStyle(.link).help("Undo (⌘Z)")
            }
            Button(action: dismiss) { Image(systemName: "xmark").font(.caption) }
                .buttonStyle(.plain).foregroundStyle(.secondary).help("Dismiss").accessibilityLabel("Dismiss")
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
    }
}

struct ItemRowView: View {
    let row: ItemRow
    var showFeedTitle = true
    var now: Date = Date()

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(row.item.isRead ? Color.clear : Color.accentColor)
                .frame(width: 8, height: 8)
                .padding(.top, 6)
                .accessibilityHidden(row.item.isRead)
                .accessibilityLabel("Unread")
            VStack(alignment: .leading, spacing: 3) {
                Text(row.item.title)
                    .font(.body.weight(row.item.isRead ? .regular : .semibold))
                    .lineLimit(2)
                HStack(spacing: 6) {
                    if showFeedTitle { Text(row.feedTitle) }
                    if let d = row.item.publishedAt {
                        if showFeedTitle { Text("·") }
                        Text(RelativeText.string(from: d, now: now))
                    }
                    if row.item.starred { Image(systemName: "star.fill").foregroundStyle(.yellow) }
                    if row.item.notes != nil { Image(systemName: "note.text") }
                }
                .font(.caption).foregroundStyle(.secondary)
                if let t = row.item.contentText, !t.isEmpty {
                    Text(t).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
        }
        .padding(.vertical, 3)
    }
}

// MARK: - Add feed

struct AddFeedSheet: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) var dismiss
    @State private var text = ""
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Subscribe").font(.headline)
            Text("Paste one URL per line. Site or post URLs are resolved to their feed automatically.")
                .font(.caption).foregroundStyle(.secondary)
            TextEditor(text: $text)
                .font(.body.monospaced())
                .frame(height: 120)
                .padding(6)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text("https://example.com/feed.xml\nhttps://another.blog/").foregroundStyle(.tertiary).padding(11).allowsHitTesting(
                            false)
                    }
                }
            HStack {
                if busy { ProgressView().controlSize(.small); Text("Resolving feeds…").font(.caption).foregroundStyle(.secondary) }
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Add") {
                    busy = true
                    Task {
                        await state.addFeeds(text: text)
                        busy = false
                        dismiss()
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
            }
        }
        .padding(20)
        .frame(width: 480)
    }
}
