import Foundation

/// OPML 2.0 subscription lists, the exchange format between feed readers.
public enum OPML {
    public struct Outline: Equatable, Sendable {
        public var title: String
        public var xmlUrl: String
        public var htmlUrl: String?
        /// Enclosing folder(s), outer to inner joined with "/"; nil at the top level.
        public var category: String?

        public init(title: String, xmlUrl: String, htmlUrl: String? = nil, category: String? = nil) {
            self.title = title
            self.xmlUrl = xmlUrl
            self.htmlUrl = htmlUrl
            self.category = category
        }
    }

    public enum ParseError: Error, LocalizedError, Equatable {
        case malformed(String)
        case noFeeds

        public var errorDescription: String? {
            switch self {
            case .malformed(let why): return "Not an OPML file: \(why)"
            case .noFeeds: return "No feeds in this OPML file"
            }
        }
    }

    /// Every `<outline xmlUrl=…>` at any depth; outlines without `xmlUrl` are folders.
    public static func parse(_ data: Data) throws -> [Outline] {
        let parser = XMLParser(data: data)
        let delegate = Delegate()
        parser.delegate = delegate
        guard parser.parse() else {
            throw ParseError.malformed(parser.parserError?.localizedDescription ?? "invalid XML")
        }
        guard delegate.sawOPML else { throw ParseError.malformed("missing <opml> root") }
        guard !delegate.outlines.isEmpty else { throw ParseError.noFeeds }
        return delegate.outlines
    }

    /// Feeds grouped by category (folders first, in name order; uncategorised feeds after).
    public static func export(_ feeds: [Feed], title: String = "Feed Reader subscriptions", date: Date = Date()) -> String {
        var out = """
            <?xml version="1.0" encoding="UTF-8"?>
            <opml version="2.0">
              <head>
                <title>\(escape(title))</title>
                <dateCreated>\(rfc822.string(from: date))</dateCreated>
              </head>
              <body>

            """
        let grouped = Dictionary(grouping: feeds) { $0.category?.trimmingCharacters(in: .whitespaces) ?? "" }
        for category in grouped.keys.sorted() where !category.isEmpty {
            out += "    <outline text=\"\(escape(category))\" title=\"\(escape(category))\">\n"
            for feed in grouped[category, default: []] { out += outline(feed, indent: "      ") }
            out += "    </outline>\n"
        }
        for feed in grouped["", default: []] { out += outline(feed, indent: "    ") }
        out += "  </body>\n</opml>\n"
        return out
    }

    private static func outline(_ feed: Feed, indent: String) -> String {
        var attrs = "type=\"rss\" text=\"\(escape(feed.title))\" title=\"\(escape(feed.title))\" xmlUrl=\"\(escape(feed.url))\""
        if let site = feed.siteURL, !site.isEmpty { attrs += " htmlUrl=\"\(escape(site))\"" }
        return "\(indent)<outline \(attrs)/>\n"
    }

    static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    private static let rfc822: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
        return f
    }()

    private final class Delegate: NSObject, XMLParserDelegate {
        var outlines: [Outline] = []
        var sawOPML = false
        /// Folder names from the root down to the current element; nil entries are feed outlines.
        private var stack: [String?] = []

        func parser(
            _ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String]
        ) {
            if name.lowercased() == "opml" { sawOPML = true }
            guard name == "outline" else { return }
            if let xml = attributes["xmlUrl"]?.trimmingCharacters(in: .whitespaces), !xml.isEmpty {
                let folders = stack.compactMap { $0 }
                let title = attributes["title"] ?? attributes["text"] ?? xml
                outlines.append(
                    Outline(
                        title: title.isEmpty ? xml : title, xmlUrl: xml, htmlUrl: attributes["htmlUrl"],
                        category: folders.isEmpty ? nil : folders.joined(separator: "/")))
                stack.append(nil)
            } else {
                let folder = (attributes["text"] ?? attributes["title"] ?? "").trimmingCharacters(in: .whitespaces)
                stack.append(folder.isEmpty ? nil : folder)
            }
        }

        func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
            if name == "outline", !stack.isEmpty { stack.removeLast() }
        }
    }
}
