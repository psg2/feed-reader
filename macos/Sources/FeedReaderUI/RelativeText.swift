import Foundation

public enum RelativeText {
    /// Foundation formatters are thread-safe once configured; the type just is not marked Sendable.
    nonisolated(unsafe) private static let formatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        f.dateTimeStyle = .numeric
        f.locale = Locale(identifier: "en_US")
        return f
    }()

    /// "just now" under a minute, otherwise an abbreviated relative form ("5 min. ago", "2 days ago").
    /// `now` is injectable so views render deterministically in tests.
    public static func string(from date: Date, now: Date = Date()) -> String {
        if abs(now.timeIntervalSince(date)) < 60 { return "just now" }
        return formatter.localizedString(for: date, relativeTo: now)
    }
}
