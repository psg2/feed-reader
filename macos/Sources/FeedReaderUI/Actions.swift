import AppKit
import FeedReaderCore
import Foundation

/// One user-facing action. The single source of truth for the key router, the shortcuts sheet,
/// the hint bar and the command palette.
public struct AppAction: Identifiable {
    public enum Section: String, CaseIterable { case navigate = "Navigate", post = "Post", app = "App" }

    public let id: String
    public let title: String
    /// Display label: the single letter when there is one ("J", "R"), else the menu shortcut ("⇧⌘K").
    /// ⌘ variants of lettered actions (⌘R, ⌘N) live only in the menu bar.
    public let shortcut: String
    /// Single unmodified key handled by KeyRouter (nil for menu shortcuts).
    public let key: String?
    public let section: Section
    public let isAvailable: () -> Bool
    public let perform: () -> Void
}

public enum FocusTarget: Equatable { case list, notes, search }

extension AppState {
    /// Builds the action list against the current list model. Called by ContentView once the models exist.
    public func makeActions(list: ItemListModel) -> [AppAction] {
        let hasSelection = { [weak self] in self?.selectedItemId != nil }
        return [
            // Navigate
            AppAction(id: "next", title: "Next post", shortcut: "J", key: "j", section: .navigate, isAvailable: { true }) {
                [weak self, weak list] in
                guard let self, let list else { return }
                if let n = list.neighbour(of: self.selectedItemId, offset: 1) { self.selectedItemId = n }
            },
            AppAction(id: "prev", title: "Previous post", shortcut: "K", key: "k", section: .navigate, isAvailable: { true }) {
                [weak self, weak list] in
                guard let self, let list else { return }
                if let n = list.neighbour(of: self.selectedItemId, offset: -1) { self.selectedItemId = n }
            },
            AppAction(id: "unread", title: "Go to Unread", shortcut: "⌘1", key: nil, section: .navigate, isAvailable: { true }) {
                [weak self] in self?.filter = .unread
            },
            AppAction(id: "all", title: "Go to All", shortcut: "⌘2", key: nil, section: .navigate, isAvailable: { true }) { [weak self] in
                self?.filter = .all
            },
            AppAction(id: "starred", title: "Go to Starred", shortcut: "⌘3", key: nil, section: .navigate, isAvailable: { true }) {
                [weak self] in self?.filter = .starred
            },
            AppAction(id: "search", title: "Search", shortcut: "/", key: "/", section: .navigate, isAvailable: { true }) { [weak self] in
                self?.requestFocus(.search)
            },
            AppAction(id: "list", title: "Back to list", shortcut: "Esc", key: "\u{1B}", section: .navigate, isAvailable: { true }) {
                [weak self] in self?.requestFocus(.list)
            },

            // Post
            AppAction(id: "read", title: "Toggle read", shortcut: "U", key: "u", section: .post, isAvailable: hasSelection) { [weak self] in
                self?.toggleReadSelected()
            },
            AppAction(id: "readNext", title: "Mark read and go to next", shortcut: "E", key: "e", section: .post, isAvailable: hasSelection)
            { [weak self, weak list] in
                guard let self, let list, let id = self.selectedItemId else { return }
                let next = list.neighbour(of: id, offset: 1)
                self.markRead(id, read: true)
                if let next { self.selectedItemId = next }
            },
            AppAction(id: "star", title: "Toggle star", shortcut: "S", key: "s", section: .post, isAvailable: hasSelection) { [weak self] in
                self?.toggleStarSelected()
            },
            AppAction(id: "open", title: "Open in browser", shortcut: "O", key: "o", section: .post, isAvailable: hasSelection) {
                [weak self] in self?.openSelectedInBrowser()
            },
            AppAction(id: "fullPage", title: "Toggle full web page", shortcut: "W", key: "w", section: .post, isAvailable: hasSelection) {
                [weak self] in self?.activeDetail?.toggleFullPage()
            },
            AppAction(id: "notes", title: "Edit notes", shortcut: "N", key: "n", section: .post, isAvailable: hasSelection) { [weak self] in
                self?.requestFocus(.notes)
            },

            // App
            AppAction(id: "refresh", title: "Refresh", shortcut: "R", key: "r", section: .app, isAvailable: { true }) { [weak self] in
                Task { await self?.refreshAll() }
            },
            AppAction(id: "markAll", title: "Mark all as read", shortcut: "⇧⌘K", key: nil, section: .app, isAvailable: { true }) {
                [weak self] in self?.markAllRead()
            },
            AppAction(id: "addFeed", title: "Add feed…", shortcut: "A", key: "a", section: .app, isAvailable: { true }) { [weak self] in
                self?.showAddFeed = true
            },
            AppAction(
                id: "undo", title: "Undo", shortcut: "⌘Z", key: nil, section: .app,
                isAvailable: { [weak self] in self?.undoManager.canUndo ?? false }
            ) { [weak self] in self?.performUndo() },
            AppAction(id: "shortcuts", title: "Keyboard shortcuts", shortcut: "?", key: "?", section: .app, isAvailable: { true }) {
                [weak self] in self?.showShortcuts = true
            },
            AppAction(id: "settings", title: "Settings…", shortcut: "⌘,", key: nil, section: .app, isAvailable: { true }) {
                NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
            },
            AppAction(id: "palette", title: "Command palette", shortcut: "⌘K", key: nil, section: .app, isAvailable: { true }) {
                [weak self] in self?.togglePalette()
            },
        ]
    }

    public func installActions(list: ItemListModel) {
        actions = makeActions(list: list)
        keys.install(
            actions.compactMap { a in
                a.key.map { key in
                    KeyRouter.Binding(key: key, title: a.title, worksWhileEditing: a.id == "list") { [weak self] in
                        guard let self else { return }
                        if self.sheetOpen {
                            if a.id == "list" { self.closeSheets() }  // Esc dismisses whatever is open
                            return
                        }
                        if a.isAvailable() { a.perform() }
                    }
                }
            })
    }

    /// Single-letter keys are suspended while a sheet is up, so typing in it never triggers actions.
    var sheetOpen: Bool { showPalette || showShortcuts || showAddFeed }

    public func closeSheets() {
        showPalette = false; showShortcuts = false; showAddFeed = false
    }

    public func togglePalette() { showPalette.toggle() }

    public func requestFocus(_ target: FocusTarget) {
        focusRequest = (target, focusRequest.1 + 1)
    }

    /// The hint bar disappears for good once the user has found `?` or ⌘K.
    public func markShortcutsDiscovered() {
        hintDismissed = true
    }
}
