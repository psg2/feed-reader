import Foundation
import Testing

@testable import FeedReaderCore

struct OPMLTests {
    static let sample = """
        <?xml version="1.0" encoding="UTF-8"?>
        <opml version="2.0">
          <head><title>Subscriptions</title></head>
          <body>
            <outline text="Tech">
              <outline text="Nested">
                <outline type="rss" text="Deep &amp; Nested" xmlUrl="https://deep.test/feed" htmlUrl="https://deep.test/"/>
              </outline>
              <outline type="rss" title="Simon" xmlUrl="https://simonwillison.net/atom/everything/"/>
            </outline>
            <outline type="rss" text="Top level" xmlUrl="https://top.test/rss"/>
            <outline text="Empty folder"/>
          </body>
        </opml>
        """

    @Test func parseWalksFoldersRecursively() throws {
        let outlines = try OPML.parse(Data(Self.sample.utf8))
        #expect(
            outlines == [
                OPML.Outline(
                    title: "Deep & Nested", xmlUrl: "https://deep.test/feed", htmlUrl: "https://deep.test/", category: "Tech/Nested"),
                OPML.Outline(title: "Simon", xmlUrl: "https://simonwillison.net/atom/everything/", category: "Tech"),
                OPML.Outline(title: "Top level", xmlUrl: "https://top.test/rss"),
            ])
    }

    @Test func parseRejectsNonOPMLAndEmptyFiles() {
        #expect(throws: OPML.ParseError.self) { try OPML.parse(Data("<html><body>nope</body></html>".utf8)) }
        #expect(throws: OPML.ParseError.noFeeds) { try OPML.parse(Data("<opml version=\"2.0\"><body/></opml>".utf8)) }
        #expect(throws: OPML.ParseError.self) { try OPML.parse(Data("not xml at all".utf8)) }
    }

    @Test func exportGroupsByCategoryAndRoundTrips() throws {
        let feeds = [
            Feed(title: "Zed <blog>", url: "https://z.test/feed", siteURL: "https://z.test/", category: nil),
            Feed(
                title: "Simon", url: "https://simonwillison.net/atom/everything/", siteURL: "https://simonwillison.net/", category: "Tech"),
            Feed(title: "Anna's \"quotes\"", url: "https://a.test/rss", category: "Tech"),
            Feed(title: "Weekly", url: "mailto:weekly@newsletters.test", category: "Newsletters"),
        ]
        let xml = OPML.export(feeds, title: "Test", date: Date(timeIntervalSince1970: 1_800_000_000))
        #expect(xml.contains("<title>Test</title>"))
        #expect(xml.contains("<dateCreated>Fri, 15 Jan 2027 08:00:00 GMT</dateCreated>"))
        #expect(xml.contains("text=\"Zed &lt;blog&gt;\""))
        #expect(xml.contains("text=\"Anna&apos;s &quot;quotes&quot;\"") || xml.contains("text=\"Anna's &quot;quotes&quot;\""))

        let back = try OPML.parse(Data(xml.utf8))
        #expect(back.map(\.xmlUrl).sorted() == feeds.map(\.url).sorted())
        #expect(back.first { $0.xmlUrl == "https://simonwillison.net/atom/everything/" }?.category == "Tech")
        #expect(back.first { $0.xmlUrl == "https://z.test/feed" }?.category == nil)
        #expect(back.first { $0.xmlUrl == "https://z.test/feed" }?.htmlUrl == "https://z.test/")
        #expect(back.first { $0.title == "Zed <blog>" } != nil, "escaping survives the round trip")
        #expect(xml.firstRange(of: "text=\"Newsletters\"")!.lowerBound < xml.firstRange(of: "text=\"Tech\"")!.lowerBound, "folders sorted")
        #expect(xml.firstRange(of: "Tech")!.lowerBound < xml.firstRange(of: "z.test")!.lowerBound, "uncategorised feeds last")
    }
}
