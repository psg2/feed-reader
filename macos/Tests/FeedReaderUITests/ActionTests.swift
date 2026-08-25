import AppKit
import FeedReaderCore
import Foundation
import Testing

@testable import FeedReaderUI

@MainActor
struct ActionTests {
    func make() throws -> (AppState, ItemListModel, [Int64]) {
        let (db, _, ids) = try ModelTests.seeded()
        let state = AppState(db: db, defaults: UserDefaults(suiteName: "ActionTests")!, autostart: false)
        let list = ItemListModel(db: db, filter: .all)
        state.installActions(list: list)
        return (state, list, ids)
    }

    func action(_ state: AppState, _ id: String) -> AppAction { state.actions.first { $0.id == id }! }

    @Test func nextAndPreviousFollowListOrder() throws {
        let (state, list, ids) = try make(); _ = list
        action(state, "next").perform()
        #expect(state.selectedItemId == ids[0], "nothing selected → first row")
        action(state, "next").perform()
        #expect(state.selectedItemId == ids[1])
        action(state, "prev").perform()
        #expect(state.selectedItemId == ids[0])
        action(state, "prev").perform()
        #expect(state.selectedItemId == ids[0], "stays on first row at the top")
    }

    @Test func readAndNextMarksThenAdvances() throws {
        let (state, list, ids) = try make(); _ = list
        state.selectedItemId = ids[0]
        action(state, "readNext").perform()
        #expect(try state.db.item(id: ids[0])?.isRead == true)
        #expect(state.selectedItemId == ids[1])
    }

    @Test func postActionsRequireSelection() throws {
        let (state, _, _) = try make()
        for id in ["read", "readNext", "star", "open", "fullPage", "notes"] {
            #expect(!action(state, id).isAvailable(), "\(id) should be unavailable without a selection")
        }
        #expect(action(state, "next").isAvailable())
    }

    @Test func singleLetterTableMatchesTheWeb() throws {
        let (state, _, _) = try make()
        let table = Dictionary(uniqueKeysWithValues: state.actions.compactMap { a in a.key.map { ($0, a.id) } })
        #expect(
            table == [
                "j": "next", "k": "prev", "e": "readNext", "u": "read", "s": "star", "o": "open", "w": "fullPage", "n": "notes",
                "/": "search", "\u{1B}": "list", "?": "shortcuts", "a": "addFeed", "r": "refresh",
            ])
        #expect(table["a"] != "analyze", "a adds a feed now")
        let commands = Dictionary(uniqueKeysWithValues: state.actions.filter { $0.key == nil }.map { ($0.id, $0.shortcut) })
        #expect(
            commands == [
                "palette": "⌘K", "markAll": "⇧⌘K", "unread": "⌘1", "all": "⌘2", "starred": "⌘3", "undo": "⌘Z", "settings": "⌘,",
            ])
        for a in state.actions where a.key != nil {
            #expect(!a.shortcut.contains("⌘"), "\(a.id): lettered actions show the letter, the ⌘ variant lives in the menu bar")
        }
    }

    @Test func everyActionHasUniqueIdAndKey() throws {
        let (state, _, _) = try make()
        let ids = state.actions.map(\.id)
        #expect(Set(ids).count == ids.count)
        let keys = state.actions.compactMap(\.key)
        #expect(Set(keys).count == keys.count, "two actions bound to the same letter")
    }

    @Test func keyRouterYieldsToTextFieldsExceptEscape() throws {
        let router = KeyRouter()
        var hits: [String] = []
        router.install([
            .init(key: "j", title: "j") { hits.append("j") },
            .init(key: "\u{1B}", title: "esc", worksWhileEditing: true) { hits.append("esc") },
        ])
        // No window → not editing: plain keys route.
        #expect(router.handle(Self.key("j")))
        #expect(!router.handle(Self.key("j", flags: .command)), "modified keys are left to the menu")
        #expect(!router.handle(Self.key("x")))
        #expect(hits == ["j"])
        // Editing text: only escape gets through.
        let window = NSWindow(
            contentRect: .init(x: 0, y: 0, width: 100, height: 100), styleMask: .borderless, backing: .buffered, defer: false)
        let tv = NSTextView(frame: .zero)
        window.contentView = tv
        window.makeFirstResponder(tv)
        #expect(KeyRouter.isEditingText(window))
        #expect(!router.handle(Self.key("j", window: window)))
        #expect(router.handle(Self.key("\u{1B}", window: window)))
        #expect(hits == ["j", "esc"])
    }

    static func key(_ chars: String, flags: NSEvent.ModifierFlags = [], window: NSWindow? = nil) -> NSEvent {
        NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: flags, timestamp: 0, windowNumber: window?.windowNumber ?? 0,
            context: nil, characters: chars, charactersIgnoringModifiers: chars, isARepeat: false, keyCode: 0)!
    }
}

@MainActor
struct SheetKeyTests {
    @Test func singleKeysAreSuspendedWhileASheetIsOpen() throws {
        let (db, _, ids) = try ModelTests.seeded()
        let state = AppState(db: db, defaults: UserDefaults(suiteName: "SheetKeyTests")!, autostart: false)
        let list = ItemListModel(db: db, filter: .all)
        state.installActions(list: list)
        state.showPalette = true
        #expect(state.keys.handle(ActionTests.key("j")), "still consumed (not typed into the list)")
        #expect(state.selectedItemId == nil)
        state.showPalette = false
        #expect(state.keys.handle(ActionTests.key("j")))
        #expect(state.selectedItemId == ids[0])
    }
}

@MainActor
struct PaletteDismissTests {
    @Test func escapeClosesOpenSheetAndCommandKToggles() throws {
        let (db, _, _) = try ModelTests.seeded()
        let state = AppState(db: db, defaults: UserDefaults(suiteName: "PaletteDismissTests")!, autostart: false)
        let list = ItemListModel(db: db, filter: .all)
        state.installActions(list: list)
        state.togglePalette()
        #expect(state.showPalette)
        state.togglePalette()
        #expect(!state.showPalette)
        state.showPalette = true
        #expect(state.keys.handle(ActionTests.key("\u{1B}")))
        #expect(!state.showPalette, "Esc dismisses the palette")
        state.showAddFeed = true
        #expect(state.keys.handle(ActionTests.key("\u{1B}")))
        #expect(!state.showAddFeed)
        withExtendedLifetime(list) {}
    }
}
