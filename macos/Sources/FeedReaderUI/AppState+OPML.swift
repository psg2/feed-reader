import AppKit
import FeedReaderCore
import Foundation
import GRDB
import UniformTypeIdentifiers

/// What an OPML import did, for the toast: `Imported 12 feeds (2 already subscribed, 1 failed)`.
public struct ImportReport: Equatable, Sendable {
    public var imported = 0
    public var alreadySubscribed = 0
    public var failed = 0

    public var summary: String {
        var extras: [String] = []
        if alreadySubscribed > 0 { extras.append("\(alreadySubscribed) already subscribed") }
        if failed > 0 { extras.append("\(failed) failed") }
        let head = "Imported \(imported) feed\(imported == 1 ? "" : "s")"
        return extras.isEmpty ? head : "\(head) (\(extras.joined(separator: ", ")))"
    }
}

/// OPML import (subscribe through the server) and export (from the mirror).
extension AppState {
    /// Subscribes to every feed in the file, skipping URLs already in the mirror. A malformed file alerts;
    /// per-feed failures only count in the report.
    @discardableResult
    public func importOPML(_ data: Data) async -> ImportReport? {
        let outlines: [OPML.Outline]
        do {
            outlines = try OPML.parse(data)
        } catch {
            errorMessage = "Could not import OPML: \(error.localizedDescription)"
            return nil
        }
        let known = Set(((try? await db.reader.read { try Feed.fetchAll($0) }) ?? []).map(\.url))
        var report = ImportReport()
        var fresh: [(url: String, category: String?)] = []
        for o in outlines {
            if known.contains(o.xmlUrl) { report.alreadySubscribed += 1 } else { fresh.append((o.xmlUrl, o.category)) }
        }
        for (_, result) in await subscribeAll(fresh) {
            switch result {
            case .success: report.imported += 1
            case .failure: report.failed += 1
            }
        }
        showToast(report.summary, undoable: false, seconds: 8)
        return report
    }

    /// The mirror's feeds as OPML text.
    public func exportOPML() -> String {
        let feeds = (try? db.reader.read { try Feed.order(Column("title")).fetchAll($0) }) ?? []
        return OPML.export(feeds)
    }

    /// File › Import OPML…
    public func presentImportOPML() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "opml") ?? .xml, .xml]
        panel.message = "Choose an OPML file exported from another reader"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task {
            do { await importOPML(try Data(contentsOf: url)) } catch { errorMessage = "Could not read \(url.lastPathComponent)" }
        }
    }

    /// File › Export OPML…
    public func presentExportOPML() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "opml") ?? .xml]
        panel.nameFieldStringValue = "Feed Reader.opml"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try exportOPML().write(to: url, atomically: true, encoding: .utf8) } catch {
            errorMessage = "Could not export: \(error.localizedDescription)"
        }
    }
}
