import Foundation
import SwiftSoup

public enum HTMLText {
    /// Plain text from an HTML fragment. Used for search, previews and LLM input.
    public static func plainText(from html: String) -> String {
        guard let doc = try? SwiftSoup.parseBodyFragment(html) else {
            return html.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
        }
        _ = try? doc.select("script, style, noscript").remove()
        let text = (try? doc.body()?.text()) ?? ""
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Elements that can run code, load documents, submit data or rewrite how the fragment resolves URLs.
    static let droppedTags = [
        "script", "style", "noscript", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "button",
        "select", "textarea", "svg", "math", "base", "link", "meta", "template", "portal",
    ]

    /// Attributes that hold a URL and must therefore point at http(s) (or mailto, for links).
    private static let urlAttributes: Set<String> = [
        "href", "src", "srcset", "poster", "action", "formaction", "background", "cite", "data", "xlink:href", "ping",
    ]

    /// Strips what could run or load code before a fragment is rendered in a WKWebView: scripts, styles, frames,
    /// objects, forms, SVG, `<base>`/`<link>`/`<meta>`, every `on*` handler, and any URL attribute that is not
    /// http(s), mailto or a relative reference (so `javascript:`, `data:`, `vbscript:`, `file:` go).
    /// Images with http(s) sources are kept. Not a substitute for turning JavaScript off in the web view.
    public static func sanitized(_ html: String) -> String {
        guard let doc = try? SwiftSoup.parseBodyFragment(html) else { return "" }
        doc.outputSettings().prettyPrint(pretty: false)  // keep whitespace as written (matters inside <pre>)
        _ = try? doc.select(droppedTags.joined(separator: ", ")).remove()
        for el in (try? doc.getAllElements()) ?? Elements() {
            for attr in el.getAttributes()?.asList() ?? [] {
                let key = attr.getKey().lowercased()
                let drop =
                    key.hasPrefix("on") || key == "srcdoc" || key == "http-equiv"
                    || (urlAttributes.contains(key) && !isAllowedURL(attr.getValue(), isSrcset: key == "srcset"))
                if drop { _ = try? el.removeAttr(attr.getKey()) }
            }
        }
        return (try? doc.body()?.html()) ?? ""
    }

    /// True for relative references and http(s)/mailto URLs. The scheme check ignores whitespace and control
    /// characters, which browsers strip before parsing (`java\tscript:`).
    static func isAllowedURL(_ raw: String, isSrcset: Bool = false) -> Bool {
        if isSrcset {
            return raw.split(separator: ",").allSatisfy { candidate in
                let url = candidate.trimmingCharacters(in: .whitespaces).split(separator: " ").first.map(String.init) ?? ""
                return isAllowedURL(url)
            }
        }
        let cleaned = String(raw.unicodeScalars.filter { !CharacterSet.whitespacesAndNewlines.contains($0) && $0.value > 0x1F })
        guard let colon = cleaned.firstIndex(of: ":") else { return true }
        let scheme = cleaned[..<colon].lowercased()
        // "foo/bar:baz" is a relative path, not a scheme.
        if scheme.contains("/") || scheme.contains("?") || scheme.contains("#") { return true }
        return ["http", "https", "mailto"].contains(scheme)
    }
}
