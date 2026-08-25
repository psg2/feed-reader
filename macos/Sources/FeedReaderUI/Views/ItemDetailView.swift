import FeedReaderCore
import SwiftUI
import WebKit

public struct ItemDetailView: View {
    @EnvironmentObject var state: AppState
    @StateObject var model: ItemDetailModel

    public init(model: ItemDetailModel) {
        _model = StateObject(wrappedValue: model)
    }

    @FocusState private var notesFocused: Bool
    @State private var allTags: [String] = []

    public var body: some View {
        Group {
            if let item = model.item {
                VSplitView {
                    VStack(alignment: .leading, spacing: 0) {
                        DetailHeader(
                            item: item, feedTitle: model.feedTitle, fullPage: model.showFullPage, toggleFullPage: model.toggleFullPage,
                            now: state.now())
                        Divider()
                        if model.showFullPage, let link = item.link, let url = URL(string: link) {
                            WebView(content: .url(url))
                        } else {
                            // Sanitized on load (see `WebView.updateNSView`), rendered with JavaScript off.
                            WebView(
                                content: .html(
                                    item.contentHTML ?? "<p><em>No content in feed.</em></p>", baseURL: item.link.flatMap(URL.init)))
                        }
                    }
                    .frame(minHeight: 300)
                    .layoutPriority(1)
                    notesPanel
                        .frame(minHeight: 140, idealHeight: 220)
                }
            } else {
                ProgressView()
            }
        }
        .onChange(of: state.reloadToken) { _, _ in
            model.reload()
            allTags = (try? state.db.allTags()) ?? []
        }
        .onAppear {
            state.activeDetail = model
            allTags = (try? state.db.allTags()) ?? []
        }
        .onChange(of: state.focusRequest.1) { _, _ in
            notesFocused = state.focusRequest.0 == .notes
        }
        .onDisappear {
            model.flush(); if state.activeDetail === model { state.activeDetail = nil }
        }
    }

    private var notesPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("Notes").font(.headline)
                if let status = model.saveStatus {
                    Text(status.text).font(.caption).foregroundStyle(.secondary)
                        .help({ if case .failed(let why) = status { return why } else { return "" } }())
                    if case .failed = status {
                        Text("·").font(.caption).foregroundStyle(.secondary)
                        Button("Retry") { model.retrySave() }.buttonStyle(.link).font(.caption)
                    }
                }
                Spacer()
            }
            .animation(.easeOut(duration: 0.3), value: model.saveStatus)
            TextEditor(text: $model.notes)
                .focused($notesFocused)
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(6)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
                .overlay(alignment: .topLeading) {
                    if model.notes.isEmpty {
                        Text("What did you learn?").foregroundStyle(.tertiary).padding(11).allowsHitTesting(false)
                    }
                }
            TagChipField(
                tags: Binding(get: { TagText.parse(model.tagsText) }, set: { model.tagsText = TagText.join($0) }),
                suggestions: allTags, onCommit: { model.saveTags() })
        }
        .padding(12)
    }
}

struct DetailHeader: View {
    @EnvironmentObject var state: AppState
    let item: Item
    let feedTitle: String
    var fullPage = false
    var toggleFullPage: () -> Void = {}
    var now: Date = Date()

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(item.title).font(.title2.weight(.semibold)).textSelection(.enabled)
            HStack(spacing: 8) {
                Text(meta)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(item.publishedAt.map { $0.formatted(date: .complete, time: .shortened) } ?? "")
                Spacer(minLength: 12)
                Button {
                    state.toggleStar(item.id ?? 0, current: item.starred)
                } label: {
                    Image(systemName: item.starred ? "star.fill" : "star").foregroundStyle(item.starred ? .yellow : .secondary)
                }
                .buttonStyle(.plain).help(item.starred ? "Unstar (S)" : "Star (S)")
                .accessibilityLabel(item.starred ? "Unstar" : "Star")
                Button {
                    state.markRead(item.id ?? 0, read: !item.isRead)
                } label: {
                    Image(systemName: item.isRead ? "envelope.open" : "envelope.badge")
                }
                .buttonStyle(.plain).help(item.isRead ? "Mark as unread (U)" : "Mark as read (U)")
                .accessibilityLabel(item.isRead ? "Mark as unread" : "Mark as read")
                if let link = item.link, let url = URL(string: link) {
                    Button(action: toggleFullPage) {
                        Image(systemName: fullPage ? "doc.richtext.fill" : "doc.richtext")
                            .foregroundStyle(fullPage ? Color.accentColor : .secondary)
                    }
                    .buttonStyle(.plain).help(fullPage ? "Show feed content (W)" : "Load full web page (W)")
                    .accessibilityLabel(fullPage ? "Show feed content" : "Load full web page")
                    Button {
                        NSWorkspace.shared.open(url)
                    } label: {
                        Image(systemName: "safari")
                    }
                    .buttonStyle(.plain).help("Open in browser (O)")
                    .accessibilityLabel("Open in browser")
                }
            }
            .font(.callout).foregroundStyle(.secondary)
        }
        .padding(12)
    }

    private var meta: String {
        var parts = [feedTitle]
        if let a = item.author, a != feedTitle { parts.append(a) }
        if let d = item.publishedAt { parts.append(RelativeText.string(from: d, now: now)) }
        return parts.joined(separator: " · ")
    }
}

// MARK: - WebView

/// Feed content is sanitized (`HTMLText.sanitized`) and rendered with JavaScript off; the full web page runs
/// with JavaScript on. Both modes use a non-persistent data store, so nothing a page sets (cookies, storage,
/// cache) outlives the view or is shared with other posts.
struct WebView: NSViewRepresentable {
    enum Content: Equatable {
        case html(String, baseURL: URL?)
        case url(URL)

        var allowsJavaScript: Bool {
            if case .url = self { return true }
            return false
        }
    }
    let content: Content

    func makeNSView(context: Context) -> WKWebView {
        let v = WKWebView(frame: .zero, configuration: Self.configuration(for: content))
        v.navigationDelegate = context.coordinator
        return v
    }

    static func configuration(for content: Content) -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = content.allowsJavaScript
        return configuration
    }

    func updateNSView(_ v: WKWebView, context: Context) {
        guard context.coordinator.loaded != content else { return }
        context.coordinator.loaded = content
        switch content {
        case .url(let url):
            v.load(URLRequest(url: url))
        case .html(let html, let baseURL):
            v.loadHTMLString(wrap(HTMLText.sanitized(html)), baseURL: baseURL)
        }
    }

    private func wrap(_ html: String) -> String {
        """
        <!doctype html><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          :root { color-scheme: light dark; }
          body { font: 15px/1.6 -apple-system, system-ui, sans-serif; max-width: 720px; margin: 16px auto; padding: 0 16px; }
          img, video { max-width: 100%; height: auto; }
          pre { overflow-x: auto; padding: 10px; background: rgba(127,127,127,.12); border-radius: 6px; }
          code { font-size: 13px; }
          blockquote { border-left: 3px solid rgba(127,127,127,.4); margin-left: 0; padding-left: 12px; color: gray; }
        </style>
        \(html)
        """
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    /// Link clicks open in the default browser in both modes, so the reader stays on the post. In full-page
    /// mode the page may still navigate itself (redirects, scripts).
    final class Coordinator: NSObject, WKNavigationDelegate {
        var loaded: Content?

        func webView(
            _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            decisionHandler(Self.policy(for: action.navigationType, url: action.request.url))
        }

        /// Clicks on links leave the app; everything else (the initial load, redirects) stays in the web view.
        static func policy(for type: WKNavigationType, url: URL?, open: (URL) -> Void = { NSWorkspace.shared.open($0) })
            -> WKNavigationActionPolicy
        {
            if type == .linkActivated, let url {
                open(url)
                return .cancel
            }
            return .allow
        }
    }
}
