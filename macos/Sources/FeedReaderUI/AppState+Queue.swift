import FeedReaderCore
import Foundation

/// Why a server URL was refused at sign-in.
public enum ServerURLError: Error, LocalizedError, Equatable {
    case malformed
    case insecure
    case signedIn

    public var errorDescription: String? {
        switch self {
        case .malformed: return "Enter the server address, like https://reader.example.com"
        case .insecure: return "The server must use https (http is allowed for localhost only)"
        case .signedIn: return "Sign out before changing the server"
        }
    }
}

/// The offline write queue: every local mutation lands in `pending_ops` and is
/// pushed in order by `SyncQueue` — right away, when the app becomes active,
/// before each pull, and on a backoff timer after a failure.
extension AppState {
    /// Records a change for the server and starts pushing.
    func enqueue(_ op: RemoteOp) {
        do {
            try db.enqueue(op)
        } catch {
            errorMessage = "Could not queue change: \(error.localizedDescription)"
            return
        }
        refreshPendingCount()
        Task { await drainQueue() }
    }

    func enqueueMarkRead(_ remoteIds: [String], read: Bool) {
        guard !remoteIds.isEmpty else { return }
        enqueue(.markRead(itemIds: remoteIds, read: read))
    }

    /// The footer's Retry: push whatever is queued without waiting for the timer, and
    /// pull again if the last pull failed.
    public func retryNow() async {
        retryTask?.cancel()
        await drainQueue()
        // `drain` joins a run that may have started before the network came back;
        // if that one stopped short, make one more attempt of our own.
        if pendingCount > 0 {
            retryTask?.cancel()
            await drainQueue()
        }
        if pullFailed, pendingCount == 0 { await syncNow() }
    }

    /// Pushes queued ops until the queue is empty or a transient error stops it,
    /// in which case a retry is scheduled with exponential backoff.
    func drainQueue() async {
        guard isSignedIn, pendingCount > 0 || ((try? db.pendingOpCount()) ?? 0) > 0 else { return }
        do {
            let outcome = try await queue.drain(api: remoteAPI)
            refreshPendingCount()
            if !outcome.dropped.isEmpty {
                let lines = outcome.dropped.map { "\($0.0.kind): \($0.1)" }
                syncError = "The server rejected \(lines.count) change\(lines.count == 1 ? "" : "s"): " + lines.joined(separator: "; ")
                notifyDroppedEdits(outcome.dropped)
            } else if outcome.pushed > 0, !outcome.remaining {
                syncError = nil
            }
            if outcome.remaining { scheduleRetry(after: Self.backoff(attempts: outcome.attempts)) }
        } catch {
            refreshPendingCount()
            reportSyncFailure(error)
        }
    }

    /// A refused notes/tags op for the post on screen shows "Couldn't save · Retry" there.
    private func notifyDroppedEdits(_ dropped: [(RemoteOp, String)]) {
        guard let detail = activeDetail, let rid = detail.item?.remoteId else { return }
        for (op, reason) in dropped {
            switch op {
            case .setNotes(let id, _) where id == rid, .setTags(let id, _) where id == rid: detail.saveFailed(reason)
            default: continue
            }
        }
    }

    /// 10s, 20s, 40s … capped at 5 minutes.
    static func backoff(attempts: Int) -> TimeInterval {
        min(300, 10 * pow(2, Double(max(0, attempts - 1))))
    }

    private func scheduleRetry(after delay: TimeInterval) {
        retryTask?.cancel()
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.drainQueue()
        }
    }

    func refreshPendingCount() {
        pendingCount = (try? db.pendingOpCount()) ?? 0
    }
}
