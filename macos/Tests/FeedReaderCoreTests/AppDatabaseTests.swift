import Foundation
import Testing

@testable import FeedReaderCore

@Suite
struct AppDatabaseTests {
    /// The mirror is disposable: a file SQLite cannot open is renamed with a timestamp and a fresh one takes its place.
    @Test func corruptMirrorIsMovedAsideAndRecreated() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("AppDatabaseTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("feedreader.sqlite")
        try Data("this is not a database".utf8).write(to: url)
        try Data().write(to: URL(fileURLWithPath: url.path + "-wal"))

        #expect(throws: (any Error).self) { try AppDatabase.open(at: url) }
        try AppDatabase.moveAside(url)
        let db = try AppDatabase.open(at: url)
        #expect(try db.enabledFeeds().isEmpty)

        let names = try FileManager.default.contentsOfDirectory(atPath: dir.path).sorted()
        #expect(names.contains { $0.hasPrefix("feedreader.sqlite.corrupt-") && !$0.hasSuffix("-wal") })
        #expect(names.contains { $0.hasPrefix("feedreader.sqlite.corrupt-") && $0.hasSuffix("-wal") })
        #expect(names.contains("feedreader.sqlite"))
    }
}
