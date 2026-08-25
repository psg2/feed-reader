import AppKit

/// Single-letter shortcuts (Gmail/Reeder style). Installed as a local event monitor so they work
/// wherever focus is, except inside text fields / text views, where typing must win.
@MainActor
public final class KeyRouter {
    public struct Binding {
        public let key: String
        public let title: String
        public let worksWhileEditing: Bool
        public let action: () -> Void
        public init(key: String, title: String, worksWhileEditing: Bool = false, action: @escaping () -> Void) {
            self.key = key; self.title = title; self.worksWhileEditing = worksWhileEditing; self.action = action
        }
    }

    public private(set) var bindings: [Binding] = []
    /// The event monitor handle; only touched from the main actor and in `deinit`.
    nonisolated(unsafe) private var monitor: Any?

    public init() {}

    public func install(_ bindings: [Binding]) {
        self.bindings = bindings
        if monitor == nil {
            monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                guard let self, self.handle(event) else { return event }
                return nil
            }
        }
    }

    /// Returns true when the event was consumed.
    func handle(_ event: NSEvent) -> Bool {
        guard event.modifierFlags.intersection([.command, .control, .option]).isEmpty,
            let chars = event.charactersIgnoringModifiers, chars.count == 1,
            let b = bindings.first(where: { $0.key == chars })
        else { return false }
        if Self.isEditingText(event.window) && !b.worksWhileEditing { return false }
        b.action()
        return true
    }

    static func isEditingText(_ window: NSWindow?) -> Bool {
        guard let responder = window?.firstResponder else { return false }
        if responder is NSTextView || responder is NSTextField { return true }
        // SwiftUI TextField/TextEditor wrap AppKit text views; their field editor is an NSTextView.
        return String(describing: type(of: responder)).lowercased().contains("text")
    }

    deinit {
        if let monitor { NSEvent.removeMonitor(monitor) }
    }
}
