import Combine
import FeedReaderCore
import Foundation
import GRDB

/// Rows for the middle column. Re-queries when filter/search change; keeps a just-read selected item
/// visible in the Unread list until the selection moves on.
@MainActor
public final class ItemListModel: ObservableObject {
    @Published public private(set) var rows: [ItemRow] = []
    @Published public private(set) var error: String?

    public private(set) var filter: ItemFilter
    public private(set) var search: String
    public var selectedItemId: Int64?

    private let db: AppDatabase
    private var observer: AnyDatabaseCancellable?

    public init(db: AppDatabase, filter: ItemFilter = .unread, search: String = "", selectedItemId: Int64? = nil) {
        self.db = db
        self.filter = filter
        self.search = search
        self.selectedItemId = selectedItemId
        reload()
    }

    public func update(filter: ItemFilter, search: String) {
        guard filter != self.filter || search != self.search else { return }
        self.filter = filter
        self.search = search
        reload()
    }

    public func reload() {
        let filter = self.filter, search = self.search
        observer =
            ValueObservation
            .tracking { @Sendable db in try AppDatabase.itemsRequest(filter: filter, search: search).fetchAll(db) }
            .start(in: db.reader, scheduling: .immediate, onError: { [weak self] e in self?.error = "List query failed: \(e)" }) {
                [weak self] rows in
                self?.apply(rows)
            }
    }

    private func apply(_ fresh: [ItemRow]) {
        if filter == .unread, let sel = selectedItemId, !fresh.contains(where: { $0.id == sel }),
            let keep = rows.first(where: { $0.id == sel })
        {
            var merged = fresh
            // Carry the persisted state (readAt etc.) if the row still exists in the DB.
            if let item = try? db.item(id: sel) {
                merged.append(ItemRow(item: item, feedTitle: keep.feedTitle))
            } else {
                merged.append(keep)
            }
            merged.sort { ($0.item.publishedAt ?? .distantPast) > ($1.item.publishedAt ?? .distantPast) }
            rows = merged
        } else {
            rows = fresh
        }
    }

    public func row(id: Int64) -> ItemRow? { rows.first { $0.id == id } }

    public func neighbour(of id: Int64?, offset: Int) -> Int64? {
        guard !rows.isEmpty else { return nil }
        guard let id, let idx = rows.firstIndex(where: { $0.id == id }) else { return rows.first?.id }
        let next = idx + offset
        return rows.indices.contains(next) ? rows[next].id : nil
    }
}
