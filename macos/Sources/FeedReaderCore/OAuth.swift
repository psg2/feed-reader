import CryptoKit
import Foundation
import Security

/// Tokens issued by the server's OAuth provider for this app.
public struct OAuthTokens: Codable, Equatable, Sendable {
    public var accessToken: String
    public var refreshToken: String
    public var expiresAt: Date

    public init(accessToken: String, refreshToken: String, expiresAt: Date) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
    }

    /// True when the access token is (about to be) expired and must be refreshed.
    public func needsRefresh(now: Date = Date(), leeway: TimeInterval = 60) -> Bool {
        expiresAt.timeIntervalSince(now) < leeway
    }
}

public enum OAuthError: Error, LocalizedError, Equatable {
    /// The refresh token was rejected: the user has to sign in again.
    case signedOut
    case server(String)
    case malformedCallback

    public var errorDescription: String? {
        switch self {
        case .signedOut: return "Your session expired. Please sign in again."
        case .server(let message): return message
        case .malformedCallback: return "The browser did not return an authorization code"
        }
    }
}

// MARK: - Token storage

public protocol TokenStore: Sendable {
    func load() -> OAuthTokens?
    func save(_ tokens: OAuthTokens)
    func clear()
}

/// Keeps the tokens in a private file (mode 0600) under Application Support.
///
/// Not the keychain on purpose: the app is ad-hoc signed and rebuilt often,
/// and every new signature makes macOS ask for the login keychain password
/// again. A user-only file gives the same protection as the rest of the
/// mirror database next to it, with no prompts.
public struct FileTokenStore: TokenStore {
    private let url: URL

    public init(url: URL) { self.url = url }

    /// `~/Library/Application Support/FeedReader/session-<host>.json`
    public static func standard(host: String) -> FileTokenStore {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FeedReader", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return FileTokenStore(url: dir.appendingPathComponent("session-\(host).json"))
    }

    public func load() -> OAuthTokens? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(OAuthTokens.self, from: data)
    }

    public func save(_ tokens: OAuthTokens) {
        guard let data = try? JSONEncoder().encode(tokens) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtection])
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    public func clear() {
        try? FileManager.default.removeItem(at: url)
    }
}

/// In-memory store for tests.
public final class MemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: OAuthTokens?

    public init(_ tokens: OAuthTokens? = nil) { self.tokens = tokens }

    public func load() -> OAuthTokens? { lock.withLock { tokens } }
    public func save(_ tokens: OAuthTokens) { lock.withLock { self.tokens = tokens } }
    public func clear() { lock.withLock { tokens = nil } }
}

// MARK: - OAuth client

/// Authorization-code + PKCE against the server's first-party `feedreader-macos`
/// client. The client is public (no secret) and pre-registered with
/// `skip_consent`, so the browser hop is just "sign in" and comes straight back.
public struct OAuthClient: Sendable {
    public let baseURL: URL
    public let clientId: String
    public let redirectURI: String
    public let scopes: [String]
    private let session: URLSession

    public static let callbackScheme = "feedreader"

    public init(
        baseURL: URL, clientId: String = "feedreader-macos", redirectURI: String = "feedreader://oauth/callback",
        scopes: [String] = ["openid", "profile", "email", "offline_access"], session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.clientId = clientId
        self.redirectURI = redirectURI
        self.scopes = scopes
        self.session = session
    }

    public struct PKCE: Sendable {
        public let verifier: String
        public let challenge: String
        public let state: String

        public static func make() -> PKCE {
            let verifier = randomURLSafe(bytes: 32)
            let digest = SHA256.hash(data: Data(verifier.utf8))
            let challenge = Data(digest).base64URLEncoded()
            return PKCE(verifier: verifier, challenge: challenge, state: randomURLSafe(bytes: 16))
        }

        private static func randomURLSafe(bytes: Int) -> String {
            var buffer = [UInt8](repeating: 0, count: bytes)
            _ = SecRandomCopyBytes(kSecRandomDefault, bytes, &buffer)
            return Data(buffer).base64URLEncoded()
        }
    }

    public func authorizeURL(_ pkce: PKCE) -> URL {
        var comps = URLComponents(url: baseURL.appendingPathComponent("api/auth/oauth2/authorize"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: scopes.joined(separator: " ")),
            URLQueryItem(name: "state", value: pkce.state),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        return comps.url!
    }

    /// Extracts the code from the `feedreader://oauth/callback?code=…&state=…` URL. The state is checked
    /// before anything else is read: a URL with the wrong state is not ours, whatever it says.
    public func code(from callback: URL, expecting pkce: PKCE) throws -> String {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard items.first(where: { $0.name == "state" })?.value == pkce.state else { throw OAuthError.malformedCallback }
        if let error = items.first(where: { $0.name == "error" })?.value {
            let description = items.first(where: { $0.name == "error_description" })?.value
            throw OAuthError.server(description ?? error)
        }
        guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty else {
            throw OAuthError.malformedCallback
        }
        return code
    }

    public func exchange(code: String, pkce: PKCE) async throws -> OAuthTokens {
        try await token([
            "grant_type": "authorization_code", "code": code, "redirect_uri": redirectURI,
            "client_id": clientId, "code_verifier": pkce.verifier,
        ])
    }

    public func refresh(_ tokens: OAuthTokens) async throws -> OAuthTokens {
        try await token(["grant_type": "refresh_token", "refresh_token": tokens.refreshToken, "client_id": clientId])
    }

    /// Best effort: revokes the refresh token (and with it the grant) on sign out.
    public func revoke(_ tokens: OAuthTokens) async {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/auth/oauth2/revoke"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "content-type")
        request.httpBody = Data(
            form(["token": tokens.refreshToken, "token_type_hint": "refresh_token", "client_id": clientId]).utf8)
        _ = try? await session.data(for: request)
    }

    private struct TokenResponse: Decodable {
        var accessToken: String?
        var refreshToken: String?
        var expiresIn: Double?
        var error: String?
        var errorDescription: String?

        enum CodingKeys: String, CodingKey {
            case accessToken = "access_token"
            case refreshToken = "refresh_token"
            case expiresIn = "expires_in"
            case error
            case errorDescription = "error_description"
        }
    }

    private func token(_ fields: [String: String]) async throws -> OAuthTokens {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/auth/oauth2/token"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "content-type")
        request.httpBody = Data(form(fields).utf8)
        request.timeoutInterval = 30
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let body =
            (try? JSONDecoder().decode(TokenResponse.self, from: data)) ?? TokenResponse()
        guard status == 200, let access = body.accessToken else {
            // invalid_grant = refresh token revoked/expired/rotated away: the grant is gone.
            if body.error == "invalid_grant" || status == 401 { throw OAuthError.signedOut }
            throw OAuthError.server(body.errorDescription ?? body.error ?? "Token request failed (\(status))")
        }
        return OAuthTokens(
            accessToken: access,
            refreshToken: body.refreshToken ?? fields["refresh_token"] ?? "",
            expiresAt: Date().addingTimeInterval(body.expiresIn ?? 3600))
    }

    private func form(_ fields: [String: String]) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return fields.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }
            .joined(separator: "&")
    }
}

/// Serialises access to the stored tokens: hands out a valid access token,
/// refreshing (once, even under concurrent callers) when it is about to expire.
public actor TokenProvider {
    private let client: OAuthClient
    private let store: TokenStore
    private var refreshing: Task<OAuthTokens, Error>?

    public init(client: OAuthClient, store: TokenStore) {
        self.client = client
        self.store = store
    }

    public var isSignedIn: Bool { store.load() != nil }

    public func set(_ tokens: OAuthTokens) { store.save(tokens) }

    public func current() -> OAuthTokens? { store.load() }

    public func clear() { store.clear() }

    /// Throws `OAuthError.signedOut` when there is no usable grant any more.
    public func accessToken(forceRefresh: Bool = false) async throws -> String {
        guard let tokens = store.load() else { throw OAuthError.signedOut }
        if !forceRefresh, !tokens.needsRefresh() { return tokens.accessToken }
        if let refreshing { return try await refreshing.value.accessToken }
        let task = Task<OAuthTokens, Error> {
            do {
                let fresh = try await client.refresh(tokens)
                store.save(fresh)
                return fresh
            } catch OAuthError.signedOut {
                store.clear()
                throw OAuthError.signedOut
            }
        }
        refreshing = task
        defer { refreshing = nil }
        return try await task.value.accessToken
    }
}

extension Data {
    fileprivate func base64URLEncoded() -> String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
