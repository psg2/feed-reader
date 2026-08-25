import AppKit
import FeedReaderCore
import SnapshotTesting
import SwiftUI

@testable import FeedReaderUI

/// Pins rendering to 1x so baselines are identical on Retina and non-Retina machines.
private final class OneXWindow: NSWindow {
    override var backingScaleFactor: CGFloat { 1 }
}

@MainActor
enum Snap {
    /// Hosts a SwiftUI view in an off-screen 1x window with the given appearance, laid out and ready to capture.
    static func host<V: View>(_ view: V, size: CGSize, appearance: NSAppearance.Name) -> NSView {
        let hv = NSHostingView(rootView: view)
        hv.frame = CGRect(origin: .zero, size: size)
        hv.appearance = NSAppearance(named: appearance)
        let window = OneXWindow(contentRect: hv.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = hv
        hv.layoutSubtreeIfNeeded()
        return hv
    }

    /// Asserts light and dark snapshots of the view.
    static func assert<V: View>(
        _ view: V, size: CGSize, name: String, file: StaticString = #filePath, testName: String = #function, line: UInt = #line
    ) {
        for (suffix, appearance) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
            assertSnapshot(
                // Tolerance absorbs antialiasing differences between machines (CI runner vs. laptop) while still catching layout changes.
                of: host(view, size: size, appearance: appearance), as: .image(precision: 0.98, perceptualPrecision: 0.95),
                named: "\(name)-\(suffix)", file: file, testName: testName,
                line: line)
        }
    }

    /// Deterministic fixture data: fixed dates, one feed, a few items in different states.
    static func fixtureDB() throws -> (AppDatabase, Feed, [Int64]) {
        let db = try AppDatabase.inMemory()
        let feed = try db.addFeed(
            Feed(
                title: "Simon Willison's Weblog", url: "https://simonwillison.net/atom/everything/", siteURL: "https://simonwillison.net/",
                createdAt: Self.epoch))
        let specs: [(String, String, Bool, Bool, String?)] = [
            (
                "More than just code review",
                "<p>The key skill required to make productive use of coding agents is being able to confidently instruct them.</p>", false,
                true, "Learned: verify, don't eyeball."
            ),
            (
                "llm 0.33", "<p>Release: llm 0.33. My highlights from this release: upgraded to the OpenAI Python library 3.x.</p>", false,
                false, nil
            ),
            (
                "Quoting Linus Torvalds",
                "<p>And this was a debug session from hell, enormously helped by an AI doing much of the grunt-work.</p>", true, false, nil
            ),
        ]
        var ids: [Int64] = []
        for (i, s) in specs.enumerated() {
            var item = Item(
                feedId: feed.id!, guid: "guid-\(i)", link: "https://simonwillison.net/\(i)/", title: s.0, author: "Simon Willison",
                publishedAt: epoch.addingTimeInterval(-Double(i) * 7200), contentHTML: s.1, contentText: HTMLText.plainText(from: s.1),
                readAt: s.2 ? epoch : nil, starred: s.3, notes: s.4, createdAt: epoch)
            ids.append(
                try db.writer.write { db in
                    try item.insert(db); return item.id!
                })
        }
        return (db, feed, ids)
    }

    static let epoch = Date(timeIntervalSince1970: 1_800_000_000)
}
