import AppKit
import FeedReaderCore
import FeedReaderUI
import SwiftUI

@main
struct FeedReaderApp: App {
    @StateObject private var state: AppState

    init() {
        // Running from `swift run` has no bundle/Info.plist: make it a regular Dock app with a menu bar.
        NSApplication.shared.setActivationPolicy(.regular)
        if Bundle.main.bundleURL.pathExtension != "app" {
            // `swift run`: no bundle, so load the icon from the package's Resources folder.
            let iconURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
                .deletingLastPathComponent().appendingPathComponent("Resources/AppIcon.icns")
            if let icon = NSImage(contentsOf: iconURL) { NSApplication.shared.applicationIconImage = icon }
        }
        let db: AppDatabase
        do {
            // A mirror that cannot be opened is moved aside and recreated (see `AppDatabase.open`).
            db = try AppDatabase.open()
        } catch {
            NSLog("Could not open the mirror database (%@); using an in-memory mirror for this session", "\(error)")
            db = try! AppDatabase.inMemory()
        }
        _state = StateObject(wrappedValue: AppState(db: db, tokenStoreForHost: { FileTokenStore.standard(host: $0) }))
    }

    var body: some Scene {
        WindowGroup("Feed Reader") {
            Group {
                if state.isSignedIn {
                    ContentView(state: state)
                } else {
                    SignInView()
                }
            }
            .environmentObject(state)
            .frame(minWidth: 1000, minHeight: 600)
            .onAppear { NSApplication.shared.activate(ignoringOtherApps: true) }
            .onOpenURL { url in state.handle(url: url) }
        }
        .commands {
            CommandGroup(replacing: .undoRedo) {
                Button("Undo") { state.performUndo() }.keyboardShortcut("z", modifiers: .command)
                Button("Redo") { state.performRedo() }.keyboardShortcut("z", modifiers: [.command, .shift])
            }
            CommandGroup(replacing: .newItem) {
                Button("Add Feed…") { state.showAddFeed = true }
                    .keyboardShortcut("n", modifiers: .command)
                    .disabled(!state.isSignedIn)
            }
            CommandGroup(replacing: .importExport) {
                Button("Import OPML…") { state.presentImportOPML() }.disabled(!state.isSignedIn)
                Button("Export OPML…") { state.presentExportOPML() }.disabled(!state.isSignedIn)
            }
            CommandMenu("Go") {
                Button("Unread") { state.filter = .unread }.keyboardShortcut("1", modifiers: .command)
                Button("All") { state.filter = .all }.keyboardShortcut("2", modifiers: .command)
                Button("Starred") { state.filter = .starred }.keyboardShortcut("3", modifiers: .command)
            }
            CommandGroup(replacing: .help) {
                Button("Command Palette") { state.togglePalette() }
                    .keyboardShortcut("k", modifiers: .command)
                    .disabled(!state.isSignedIn)
                Button("Keyboard Shortcuts") { state.showShortcuts = true }
                    .keyboardShortcut("/", modifiers: .command)
            }
            CommandGroup(after: .newItem) {
                Button("Refresh") { Task { await state.refreshAll() } }
                    .keyboardShortcut("r", modifiers: .command)
                    .disabled(!state.isSignedIn)
                Button("Mark All as Read") { state.markAllRead() }
                    .keyboardShortcut("k", modifiers: [.command, .shift])
                    .disabled(!state.isSignedIn)
                Divider()
                Button("Toggle Read") { state.toggleReadSelected() }
                    .keyboardShortcut("u", modifiers: .command)
                    .disabled(state.selectedItemId == nil)
                Button("Toggle Star") { state.toggleStarSelected() }
                    .keyboardShortcut("d", modifiers: .command)
                    .disabled(state.selectedItemId == nil)
                Button("Open in Browser") { state.openSelectedInBrowser() }
                    .keyboardShortcut("o", modifiers: [.command, .shift])
                    .disabled(state.selectedItemId == nil)
            }
        }
        Settings {
            SettingsView().environmentObject(state)
        }
    }
}
