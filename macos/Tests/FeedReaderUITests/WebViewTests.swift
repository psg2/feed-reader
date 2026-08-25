import Foundation
import Testing
import WebKit

@testable import FeedReaderUI

/// The web view's navigation policy and configuration.
@MainActor
struct WebViewTests {
    @Test func linkClicksOpenInTheBrowserAndAreCancelled() {
        var opened: [URL] = []
        let url = URL(string: "https://example.com/next")!
        let policy = WebView.Coordinator.policy(for: .linkActivated, url: url) { opened.append($0) }
        #expect(policy == .cancel)
        #expect(opened == [url])
    }

    @Test func otherNavigationsStayInTheWebView() {
        var opened: [URL] = []
        let url = URL(string: "https://example.com/post")!
        #expect(WebView.Coordinator.policy(for: .other, url: url) { opened.append($0) } == .allow)
        #expect(WebView.Coordinator.policy(for: .reload, url: url) { opened.append($0) } == .allow)
        #expect(WebView.Coordinator.policy(for: .linkActivated, url: nil) { opened.append($0) } == .allow)
        #expect(opened.isEmpty)
    }

    /// The witness matches WebKit's optional requirement; a near-miss compiles but never gets called.
    @Test func coordinatorImplementsDecidePolicy() {
        let coordinator = WebView.Coordinator()
        #expect(coordinator.responds(to: NSSelectorFromString("webView:decidePolicyForNavigationAction:decisionHandler:")))
    }

    @Test func feedContentRunsWithoutJavaScriptAndWithoutPersistentStorage() {
        let feed = WebView.configuration(for: .html("<p>x</p>", baseURL: nil))
        #expect(!feed.defaultWebpagePreferences.allowsContentJavaScript)
        #expect(!feed.websiteDataStore.isPersistent)
        let page = WebView.configuration(for: .url(URL(string: "https://example.com")!))
        #expect(page.defaultWebpagePreferences.allowsContentJavaScript, "the full page is the site's own, scripts included")
        #expect(!page.websiteDataStore.isPersistent)
    }
}
