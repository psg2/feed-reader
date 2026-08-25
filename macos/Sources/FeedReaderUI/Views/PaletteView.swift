import FeedReaderCore
import SwiftUI

/// ⌘K command palette. Lists every available action plus feeds, tags and matching posts; Enter runs the highlighted row.
struct PaletteView: View {
    @EnvironmentObject var state: AppState
    @ObservedObject var sidebar: SidebarModel
    @State private var query = ""
    @State private var highlighted: String?
    @FocusState private var fieldFocused: Bool

    private var all: [PaletteItem] {
        PaletteModel.items(actions: state.actions, feeds: sidebar.feeds, tags: sidebar.tags) { [weak state] f in state?.filter = f }
    }
    private var results: [PaletteItem] {
        PaletteModel.filter(all, query: query)
            + PaletteModel.searchItems(
                query: query, db: state.db,
                open: { [weak state] id in
                    state?.filter = .all; state?.search = ""; state?.selectedItemId = id
                }, search: { [weak state] q in state?.search = q })
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Command, feed, tag or search posts…", text: $query)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .focused($fieldFocused)
                    .onSubmit(runHighlighted)
                    .onKeyPress(.downArrow) {
                        move(1); return .handled
                    }
                    .onKeyPress(.upArrow) {
                        move(-1); return .handled
                    }
            }
            .padding(12)
            Divider()
            if results.isEmpty {
                Text("No matches").foregroundStyle(.secondary).padding(20)
                Spacer()
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(grouped, id: \.section) { group in
                                Text(group.section).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                    .padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 2)
                                ForEach(group.items) { item in
                                    row(item)
                                        .id(item.id)
                                        .contentShape(Rectangle())
                                        .onTapGesture { run(item) }
                                        .onHover { if $0 { highlighted = item.id } }
                                }
                            }
                        }
                        .padding(.bottom, 8)
                    }
                    .onChange(of: highlighted) { _, id in if let id { proxy.scrollTo(id) } }
                }
            }
        }
        .frame(width: 560, height: 400)
        .onAppear {
            highlighted = results.first?.id
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(50)); fieldFocused = true
            }
        }
        .onChange(of: query) { _, _ in highlighted = results.first?.id }
    }

    private var grouped: [(section: String, items: [PaletteItem])] {
        var order: [String] = []
        var map: [String: [PaletteItem]] = [:]
        for r in results {
            if map[r.section] == nil { order.append(r.section) }
            map[r.section, default: []].append(r)
        }
        return order.map { ($0, map[$0]!) }
    }

    private func row(_ item: PaletteItem) -> some View {
        HStack {
            Image(systemName: icon(item.kind)).foregroundStyle(.secondary).frame(width: 16)
            Text(item.title).lineLimit(1)
            if let s = item.subtitle { Text(s).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            Spacer()
            if let k = item.shortcut { Text(k).font(.callout.monospaced()).foregroundStyle(.secondary) }
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(highlighted == item.id ? Color.accentColor.opacity(0.18) : .clear, in: RoundedRectangle(cornerRadius: 6))
        .padding(.horizontal, 6)
    }

    private func icon(_ k: PaletteItem.Kind) -> String {
        switch k {
        case .action: "command";
        case .feed: "dot.radiowaves.up.forward";
        case .tag: "tag"
        case .post: "doc.text";
        case .search: "magnifyingglass"
        }
    }

    private func move(_ delta: Int) {
        let r = results
        guard !r.isEmpty else { return }
        let i = r.firstIndex { $0.id == highlighted } ?? -1
        highlighted = r[max(0, min(r.count - 1, i + delta))].id
    }

    private func runHighlighted() {
        if let item = results.first(where: { $0.id == highlighted }) ?? results.first { run(item) }
    }

    private func run(_ item: PaletteItem) {
        state.showPalette = false
        // Let the panel close before the action moves focus or opens a sheet.
        DispatchQueue.main.async { item.perform() }
    }
}

// MARK: - Panel

/// Floating child window for the palette. A window (not an overlay) because hosted NSViews such as
/// WKWebView paint above SwiftUI overlays. Closes when it stops being key (click outside).
@MainActor
final class PalettePanel: NSObject, NSWindowDelegate {
    private final class KeyPanel: NSPanel {
        override var canBecomeKey: Bool { true }
    }

    private var panel: KeyPanel?
    private var onDismiss: (() -> Void)?

    func show<V: View>(_ content: V, over parent: NSWindow, onDismiss: @escaping () -> Void) {
        hide()
        self.onDismiss = onDismiss
        let host = NSHostingView(rootView: content)
        let size = host.fittingSize
        let p = KeyPanel(
            contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .fullSizeContentView], backing: .buffered, defer: false
        )
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = true
        p.isMovable = false
        p.delegate = self
        let box = NSVisualEffectView(frame: NSRect(origin: .zero, size: size))
        box.material = .popover
        box.state = .active
        box.wantsLayer = true
        box.layer?.cornerRadius = 12
        box.layer?.masksToBounds = true
        host.frame = box.bounds
        host.autoresizingMask = [.width, .height]
        box.addSubview(host)
        p.contentView = box
        let f = parent.frame
        p.setFrameOrigin(NSPoint(x: f.midX - size.width / 2, y: f.maxY - size.height - 90))
        parent.addChildWindow(p, ordered: .above)
        p.makeKeyAndOrderFront(nil)
        panel = p
    }

    func hide() {
        guard let p = panel else { return }
        panel = nil
        p.delegate = nil
        p.parent?.removeChildWindow(p)
        p.orderOut(nil)
    }

    func windowDidResignKey(_ notification: Notification) {
        onDismiss?()
    }
}
