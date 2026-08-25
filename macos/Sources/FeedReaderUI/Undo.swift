import AppKit
import Foundation

/// A transient "Marked as read · Undo" message shown at the bottom of the list.
public struct Toast: Equatable, Identifiable {
    public let id = UUID()
    public let message: String
    public let undoable: Bool
    public static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
}

extension AppState {
    /// Routes ⌘Z: text being edited gets its own undo; otherwise the app-level undo stack.
    public func performUndo() {
        if let tv = NSApp.keyWindow?.firstResponder as? NSTextView, let um = tv.undoManager, um.canUndo {
            um.undo()
        } else {
            undoManager.undo()
        }
    }

    public func performRedo() {
        if let tv = NSApp.keyWindow?.firstResponder as? NSTextView, let um = tv.undoManager, um.canRedo {
            um.redo()
        } else {
            undoManager.redo()
        }
    }

    func showToast(_ message: String, undoable: Bool = true, seconds: Double = 5) {
        let t = Toast(message: message, undoable: undoable)
        toast = t
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            if !Task.isCancelled, self?.toast == t { self?.toast = nil }
        }
    }

    public func dismissToast() {
        toastTask?.cancel()
        toast = nil
    }

    public func undoFromToast() {
        dismissToast()
        undoManager.undo()
    }
}
