import Foundation
import Testing

@testable import FeedReaderCore

/// What `HTMLText.sanitized` removes before feed content reaches the web view, and what it leaves alone.
@Suite
struct HTMLTextTests {
    private func clean(_ html: String) -> String { HTMLText.sanitized(html).lowercased() }

    @Test func keepsOrdinaryMarkupAndHTTPImages() {
        let html = """
            <h1>Title</h1><p>Some <a href="https://example.com/post">text</a> and <code>code</code>.</p>
            <img src="https://example.com/a.png" alt="a" width="10">
            <img src="//cdn.example.com/b.png" srcset="https://example.com/b.png 1x, https://example.com/b@2x.png 2x">
            <img src="relative/c.png">
            """
        let out = clean(html)
        #expect(out.contains(#"<a href="https://example.com/post">text</a>"#))
        #expect(out.contains(#"src="https://example.com/a.png""#))
        #expect(out.contains(#"src="//cdn.example.com/b.png""#))
        #expect(out.contains(#"srcset="https://example.com/b.png 1x, https://example.com/b@2x.png 2x""#))
        #expect(out.contains(#"src="relative/c.png""#))
        #expect(out.contains("<code>code</code>"))
    }

    @Test func dropsScriptsStylesAndNoscript() {
        let out = clean("<p>a</p><script>alert(1)</script><style>p{display:none}</style><noscript><img src=x></noscript><p>b</p>")
        #expect(!out.contains("script"))
        #expect(!out.contains("style"))
        #expect(!out.contains("alert"))
        #expect(out.contains("<p>a</p>") && out.contains("<p>b</p>"))
    }

    @Test func dropsEventHandlers() {
        let out = clean(#"<img src="https://e.com/x.png" onerror="alert(1)" ONLOAD="x()"><div onclick="go()">c</div>"#)
        #expect(!out.contains("onerror") && !out.contains("onload") && !out.contains("onclick"))
        #expect(out.contains(#"src="https://e.com/x.png""#))
        #expect(out.contains("<div>c</div>"))
    }

    @Test func dropsJavaScriptAndDataURLs() {
        let out = clean(
            """
            <a href="javascript:alert(1)">1</a>
            <a href="JAVASCRIPT:alert(2)">2</a>
            <a href="java\tscript:alert(3)">3</a>
            <a href=" javascript:alert(4)">4</a>
            <a href="data:text/html,<script>alert(5)</script>">5</a>
            <a href="vbscript:x">6</a>
            <a href="file:///etc/passwd">7</a>
            <img src="data:image/png;base64,AAAA">
            <img srcset="data:image/png;base64,AAAA 1x">
            <a href="mailto:me@example.com">mail</a>
            <a href="#anchor">anchor</a>
            <a href="/path?x=a:b">query</a>
            """)
        #expect(!out.contains("javascript"))
        #expect(!out.contains("data:"))
        #expect(!out.contains("vbscript"))
        #expect(!out.contains("file:"))
        #expect(out.contains(#"href="mailto:me@example.com""#))
        #expect(out.contains(##"href="#anchor""##))
        #expect(out.contains(#"href="/path?x=a:b""#))
        #expect(out.contains(">1</a>") && out.contains(">5</a>"), "the element stays, only its URL goes")
    }

    @Test func dropsBaseLinkAndMeta() {
        let out = clean(
            """
            <base href="https://evil.example/"><link rel="stylesheet" href="https://evil.example/x.css">
            <meta http-equiv="refresh" content="0;url=https://evil.example"><meta name="viewport" content="x"><p>ok</p>
            """)
        #expect(!out.contains("<base") && !out.contains("<link") && !out.contains("<meta"))
        #expect(!out.contains("evil.example"))
        #expect(out.contains("<p>ok</p>"))
    }

    @Test func dropsFramesObjectsFormsAndSVG() {
        let out = clean(
            """
            <iframe src="https://e.com" srcdoc="<script>x</script>"></iframe><frame src="x"><object data="x.swf"></object>
            <embed src="x.swf"><applet code="x"></applet>
            <form action="https://e.com/steal"><input name="p"><button>go</button><select><option>1</option></select>
            <textarea></textarea></form>
            <svg><script>alert(1)</script><a href="javascript:x"><text>svg</text></a></svg><math><mi>x</mi></math>
            <template><img src=x onerror=alert(1)></template><p>ok</p>
            """)
        for tag in HTMLText.droppedTags {
            #expect(!out.contains("<\(tag)"), "\(tag) is removed")
        }
        #expect(!out.contains("alert") && !out.contains("steal") && !out.contains("srcdoc"))
        #expect(out.contains("<p>ok</p>"))
    }

    @Test func urlSchemeCheck() {
        #expect(HTMLText.isAllowedURL("https://a.b/c"))
        #expect(HTMLText.isAllowedURL("http://a.b/c"))
        #expect(HTMLText.isAllowedURL("HTTPS://A.B"))
        #expect(HTMLText.isAllowedURL("mailto:a@b.c"))
        #expect(HTMLText.isAllowedURL("//a.b/c"))
        #expect(HTMLText.isAllowedURL("c.png"))
        #expect(HTMLText.isAllowedURL(""))
        #expect(HTMLText.isAllowedURL("/x?time=10:30"))
        #expect(!HTMLText.isAllowedURL("javascript:1"))
        #expect(!HTMLText.isAllowedURL("\u{01}java\nscript:1"))
        #expect(!HTMLText.isAllowedURL("data:text/html,x"))
        #expect(!HTMLText.isAllowedURL("ftp://a.b"))
        #expect(HTMLText.isAllowedURL("https://a.b/1.png 1x, https://a.b/2.png 2x", isSrcset: true))
        #expect(!HTMLText.isAllowedURL("https://a.b/1.png 1x, data:x 2x", isSrcset: true))
    }

    @Test func malformedInputDoesNotCrash() {
        #expect(HTMLText.sanitized("") == "")
        #expect(!HTMLText.sanitized("<p><b>unclosed <i>tags").isEmpty)
        #expect(!HTMLText.sanitized("<<>>\u{0}<img src=\"https://a.b/x.png\"").isEmpty)
    }

    @Test func plainTextStripsMarkup() {
        #expect(HTMLText.plainText(from: "<p>Hello <b>world</b></p><script>x</script>") == "Hello world")
    }
}
