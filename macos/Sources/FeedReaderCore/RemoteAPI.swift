import Foundation

/// Connection settings for the server.
public struct RemoteConfig: Sendable {
    public var baseURL: URL
    /// Produces the bearer for each request (an OAuth access token, refreshed
    /// as needed, or a fixed `app_` API key in scripts/tests). `forceRefresh`
    /// is set when the previous token was rejected with 401.
    public var authorization: @Sendable (_ forceRefresh: Bool) async throws -> String

    public init(baseURL: URL, authorization: @escaping @Sendable (_ forceRefresh: Bool) async throws -> String) {
        self.baseURL = baseURL
        self.authorization = authorization
    }

    /// Fixed bearer (API key), for scripts and tests.
    public init(baseURL: URL, apiKey: String) {
        self.init(baseURL: baseURL) { _ in apiKey }
    }

    /// OAuth: tokens from the provider, refreshed on expiry or after a 401.
    public init(baseURL: URL, tokens: TokenProvider) {
        self.init(baseURL: baseURL) { force in try await tokens.accessToken(forceRefresh: force) }
    }
}

public enum RemoteError: Error, LocalizedError {
    case http(Int, String)
    case api(status: Int, code: String, message: String)
    case decoding(String)

    public var errorDescription: String? {
        switch self {
        case .http(let status, let body): return "Server returned \(status): \(body.prefix(200))"
        case .api(_, let code, let message): return "\(code): \(message)"
        case .decoding(let detail): return "Unexpected server response: \(detail)"
        }
    }
}

/// Minimal oRPC client for the web app's reader API.
///
/// The server speaks oRPC's RPC protocol: `POST {base}/api/rpc/reader/<route>`
/// with body `{"json": <input>}` (`{}` for void inputs) and responses wrapped
/// the same way. Dates in the `sync` dump travel as ISO-8601 strings — the
/// server contract uses string dates on purpose so this client can decode
/// plain JSON. Auth is a bearer token from `RemoteConfig.authorization`.
public final class RemoteAPI: Sendable {
    public let config: RemoteConfig
    private let session: URLSession

    public init(config: RemoteConfig, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    // MARK: - Payloads

    public struct SyncFeed: Decodable, Sendable {
        public let id: String
        public let title: String
        public let url: String
        public let siteUrl: String?
        public let category: String?
        public let enabled: Bool
        public let fullPage: Bool
        public let lastFetchedAt: String?
        public let lastError: String?
    }

    public struct SyncItem: Decodable, Sendable {
        public let id: String
        public let feedId: String
        public let guid: String
        public let link: String?
        public let title: String
        public let author: String?
        public let publishedAt: String?
        public let contentHtml: String?
        public let contentText: String?
        public let readAt: String?
        public let starred: Bool
        public let notes: String?
        public let tags: [String]
    }

    public struct SyncDump: Decodable, Sendable {
        public let feeds: [SyncFeed]
        public let items: [SyncItem]
    }

    public struct RefreshSummary: Decodable, Sendable {
        public let feedsChecked: Int
        public let feedsFailed: Int
        public let newItems: Int
    }

    // MARK: - Routes

    public func sync() async throws -> SyncDump {
        try await call("sync")
    }

    public func refresh() async throws -> RefreshSummary {
        try await call("refresh")
    }

    public func markRead(remoteIds: [String], read: Bool) async throws {
        struct In: Encodable {
            let itemIds: [String]
            let read: Bool
        }
        struct Out: Decodable { let changed: [String] }
        let _: Out = try await call("markRead", input: In(itemIds: remoteIds, read: read))
    }

    public func updateItem(
        remoteId: String, read: Bool? = nil, starred: Bool? = nil, notes: String? = nil, tags: [String]? = nil
    ) async throws {
        struct In: Encodable {
            let itemId: String
            let read: Bool?
            let starred: Bool?
            let notes: String?
            let tags: [String]?
        }
        struct Out: Decodable { let id: String? }
        let _: Out? = try await call("updateItem", input: In(itemId: remoteId, read: read, starred: starred, notes: notes, tags: tags))
    }

    @discardableResult
    public func subscribe(url: String, category: String? = nil) async throws -> SyncFeed {
        struct In: Encodable {
            let url: String
            let category: String?
        }
        struct Out: Decodable {
            let id: String
            let title: String
            let url: String
            let siteUrl: String?
            let category: String?
            let enabled: Bool
            let fullPage: Bool
        }
        let out: Out = try await call("subscribe", input: In(url: url, category: category))
        return SyncFeed(
            id: out.id, title: out.title, url: out.url, siteUrl: out.siteUrl, category: out.category,
            enabled: out.enabled, fullPage: out.fullPage, lastFetchedAt: nil, lastError: nil)
    }

    public func updateFeed(
        remoteId: String, title: String? = nil, category: String?? = nil, enabled: Bool? = nil, fullPage: Bool? = nil
    ) async throws {
        // Double-optional category: `.some(nil)` clears it server-side.
        var fields: [String: AnyEncodable] = ["feedId": AnyEncodable(remoteId)]
        if let title { fields["title"] = AnyEncodable(title) }
        if case .some(let c) = category { fields["category"] = AnyEncodable(c) }
        if let enabled { fields["enabled"] = AnyEncodable(enabled) }
        if let fullPage { fields["fullPage"] = AnyEncodable(fullPage) }
        struct Out: Decodable { let id: String? }
        let _: Out? = try await call("updateFeed", input: fields)
    }

    public func removeFeed(remoteId: String) async throws {
        struct In: Encodable { let feedId: String }
        struct Out: Decodable { let success: Bool }
        let _: Out = try await call("removeFeed", input: In(feedId: remoteId))
    }

    // MARK: - Transport

    private struct Envelope<T: Decodable>: Decodable { let json: T }
    private struct ErrorBody: Decodable {
        let code: String?
        let message: String?
    }

    private func call<Out: Decodable>(_ route: String) async throws -> Out {
        try await call(route, input: Optional<Bool>.none)
    }

    private func call<Out: Decodable>(_ route: String, input: (some Encodable)?) async throws -> Out {
        let url = config.baseURL.appendingPathComponent("api/rpc/reader/\(route)")
        let body: Data
        if let input {
            body = try JSONEncoder().encode(["json": input])
        } else {
            body = Data("{}".utf8)  // void input: empty envelope
        }

        var (data, status) = try await send(url: url, body: body, forceRefresh: false)
        if status == 401 {
            // Access token rejected: refresh once and retry.
            (data, status) = try await send(url: url, body: body, forceRefresh: true)
        }

        let decoder = JSONDecoder()
        guard (200..<300).contains(status) else {
            if let err = try? decoder.decode(Envelope<ErrorBody>.self, from: data).json, let code = err.code {
                throw RemoteError.api(status: status, code: code, message: err.message ?? "")
            }
            throw RemoteError.http(status, String(data: data, encoding: .utf8) ?? "")
        }
        do {
            return try decoder.decode(Envelope<Out>.self, from: data).json
        } catch {
            throw RemoteError.decoding("\(error)")
        }
    }

    private func send(url: URL, body: Data, forceRefresh: Bool) async throws -> (Data, Int) {
        let bearer = try await config.authorization(forceRefresh)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "authorization")
        request.timeoutInterval = 60
        request.httpBody = body
        let (data, response) = try await session.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}

/// Type-erased Encodable for heterogeneous oRPC inputs (e.g. optional PATCH fields).
public struct AnyEncodable: Encodable {
    private let encodeFn: (Encoder) throws -> Void

    public init(_ value: (some Encodable)?) {
        encodeFn = { encoder in
            var container = encoder.singleValueContainer()
            if let value { try container.encode(value) } else { try container.encodeNil() }
        }
    }

    public func encode(to encoder: Encoder) throws { try encodeFn(encoder) }
}

extension RemoteAPI {
    /// Parses the ISO-8601 strings the sync dump uses (fractional seconds optional).
    public static func date(_ string: String?) -> Date? {
        guard let string else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: string) { return d }
        let plain = ISO8601DateFormatter()
        return plain.date(from: string)
    }
}
