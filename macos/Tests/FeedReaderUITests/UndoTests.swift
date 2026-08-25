import FeedReaderCore
import Foundation
import Testing

@testable import FeedReaderUI

@MainActor
struct UndoTests {
    func make() throws -> (AppState, [Int64]) {
        let (db, _, ids) = try ModelTests.seeded()
        let state = AppState(db: db, defaults: UserDefaults(suiteName: "UndoTests")!, autostart: false)
        return (state, ids)
    }

    @Test func markReadIsUndoableAndRedoable() throws {
        let (state, ids) = try make()
        state.markRead(ids[0], read: true)
        #expect(try state.db.item(id: ids[0])?.isRead == true)
        #expect(state.toast?.message == "Marked as read")
        #expect(state.undoManager.canUndo)
        state.undoManager.undo()
        #expect(try state.db.item(id: ids[0])?.isRead == false)
        state.undoManager.redo()
        #expect(try state.db.item(id: ids[0])?.isRead == true)
    }

    @Test func markReadNoopDoesNotRegisterUndo() throws {
        let (state, ids) = try make()
        state.markRead(ids[2], read: true)  // already read
        #expect(!state.undoManager.canUndo)
        #expect(state.toast == nil)
    }

    @Test func markAllReadUndoRestoresOnlyAffectedItems() throws {
        let (state, ids) = try make()
        // ids[2] was read before; it must stay read after undo.
        state.markAllRead()
        #expect(try state.db.reader.read { db in try AppDatabase.itemsRequest(filter: .unread).fetchCount(db) } == 0)
        #expect(state.toast?.message == "Marked 2 as read")
        state.undoManager.undo()
        let unread = try state.db.reader.read { db in try AppDatabase.itemsRequest(filter: .unread).fetchAll(db) }.map(\.id)
        #expect(Set(unread) == Set([ids[0], ids[1]]))
        #expect(try state.db.item(id: ids[2])?.isRead == true, "previously-read item untouched by undo")
        state.undoManager.redo()
        #expect(try state.db.reader.read { db in try AppDatabase.itemsRequest(filter: .unread).fetchCount(db) } == 0)
    }

    @Test func starUndo() throws {
        let (state, ids) = try make()
        state.toggleStar(ids[0], current: false)
        #expect(try state.db.item(id: ids[0])?.starred == true)
        state.undoManager.undo()
        #expect(try state.db.item(id: ids[0])?.starred == false)
    }

    @Test func undoFromToastClearsToast() throws {
        let (state, ids) = try make()
        state.markRead(ids[0])
        state.undoFromToast()
        #expect(state.toast == nil)
        #expect(try state.db.item(id: ids[0])?.isRead == false)
    }
}
