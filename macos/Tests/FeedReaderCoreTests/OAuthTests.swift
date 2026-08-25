import FeedReaderCore
import Foundation
import TestSupport
import Testing

@Suite
struct OAuthTests {
    private let base = URL(string: "https://oauth.test")!

    @Test func pkceChallengeIsSha256OfVerifierAndAuthorizeURLCarriesIt() {
        let pkce = OAuthClient.PKCE.make()
        #expect(pkce.verifier.count >= 43)
        #expect(!pkce.challenge.contains("="))
        let url = OAuthClient(baseURL: base).authorizeURL(pkce)
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
        #expect(url.path == "/api/auth/oauth2/authorize")
        #expect(items.first { $0.name == "client_id" }?.value == "feedreader-macos")
        #expect(items.first { $0.name == "redirect_uri" }?.value == "feedreader://oauth/callback")
        #expect(items.first { $0.name == "code_challenge" }?.value == pkce.challenge)
        #expect(items.first { $0.name == "code_challenge_method" }?.value == "S256")
        #expect(items.first { $0.name == "scope" }?.value == "openid profile email offline_access")
    }

    @Test func callbackStateMismatchIsRejected() throws {
        let client = OAuthClient(baseURL: base)
        let pkce = OAuthClient.PKCE.make()
        let good = URL(string: "feedreader://oauth/callback?code=abc&state=\(pkce.state)")!
        #expect(try client.code(from: good, expecting: pkce) == "abc")
        let bad = URL(string: "feedreader://oauth/callback?code=abc&state=other")!
        #expect(throws: OAuthError.malformedCallback) { try client.code(from: bad, expecting: pkce) }
        let denied = URL(string: "feedreader://oauth/callback?error=access_denied&error_description=nope&state=\(pkce.state)")!
        #expect(throws: OAuthError.server("nope")) { try client.code(from: denied, expecting: pkce) }
    }

    @Test func callbackErrorIsIgnoredUnlessTheStateMatches() {
        let client = OAuthClient(baseURL: base)
        let pkce = OAuthClient.PKCE.make()
        let forged = URL(string: "feedreader://oauth/callback?error=access_denied&error_description=Account%20locked")!
        #expect(throws: OAuthError.malformedCallback) { try client.code(from: forged, expecting: pkce) }
        let wrongState = URL(string: "feedreader://oauth/callback?error=server_error&state=other")!
        #expect(throws: OAuthError.malformedCallback) { try client.code(from: wrongState, expecting: pkce) }
    }

    @Test func exchangeSendsPkceVerifierAsFormAndDecodesTokens() async throws {
        let session = stubbedSession([
            "https://oauth.test/api/auth/oauth2/token": Data(
                #"{"access_token":"AT1","refresh_token":"RT1","expires_in":3600,"token_type":"Bearer"}"#.utf8)
        ])
        let client = OAuthClient(baseURL: base, session: session)
        let pkce = OAuthClient.PKCE.make()
        let tokens = try await client.exchange(code: "the-code", pkce: pkce)
        #expect(tokens.accessToken == "AT1")
        #expect(tokens.refreshToken == "RT1")
        #expect(tokens.expiresAt > Date().addingTimeInterval(3500))
        let sent = StubURLProtocol.requests(to: "https://oauth.test/api/auth/oauth2/token").last
        let form = String(decoding: sent?.body ?? Data(), as: UTF8.self)
        #expect(sent?.method == "POST")
        #expect(form.contains("grant_type=authorization_code"))
        #expect(form.contains("code_verifier=\(pkce.verifier)"))
        #expect(form.contains("client_id=feedreader-macos"))
    }

    @Test func providerRefreshesExpiredTokenOnceAndSignsOutOnInvalidGrant() async throws {
        let tokenURL = "https://refresh.test/api/auth/oauth2/token"
        StubURLProtocol.stub(
            tokenURL,
            [
                .init(body: Data(#"{"access_token":"AT2","refresh_token":"RT2","expires_in":3600}"#.utf8)),
                .init(status: 400, body: Data(#"{"error":"invalid_grant","error_description":"revoked"}"#.utf8)),
            ])
        let session = stubbedSession()
        let client = OAuthClient(baseURL: URL(string: "https://refresh.test")!, session: session)
        let store = MemoryTokenStore(OAuthTokens(accessToken: "AT1", refreshToken: "RT1", expiresAt: Date().addingTimeInterval(-10)))
        let provider = TokenProvider(client: client, store: store)

        // Expired → refreshed (and rotated refresh token persisted).
        #expect(try await provider.accessToken() == "AT2")
        #expect(store.load()?.refreshToken == "RT2")
        // Fresh → served from the store, no request.
        #expect(try await provider.accessToken() == "AT2")
        #expect(StubURLProtocol.requests(to: tokenURL).count == 1)

        // Forced refresh hits invalid_grant → store cleared, signedOut surfaces.
        await #expect(throws: OAuthError.signedOut) { try await provider.accessToken(forceRefresh: true) }
        #expect(store.load() == nil)
        #expect(await provider.isSignedIn == false)
    }

    @Test func remoteAPIRetriesOnceWithRefreshedTokenAfter401() async throws {
        let route = "https://retry.test/api/rpc/reader/refresh"
        StubURLProtocol.stub(
            route,
            [
                .init(status: 401, body: Data(#"{"json":{"code":"UNAUTHORIZED"}}"#.utf8)),
                .init(body: Data(#"{"json":{"feedsChecked":1,"feedsFailed":0,"newItems":2}}"#.utf8)),
            ])
        let session = stubbedSession()
        let calls = Locked<[Bool]>([])
        let config = RemoteConfig(baseURL: URL(string: "https://retry.test")!) { force in
            calls.withLock { $0.append(force) }
            return force ? "fresh" : "stale"
        }
        let api = RemoteAPI(config: config, session: session)
        let summary = try await api.refresh()
        #expect(summary.newItems == 2)
        #expect(calls.withLock { $0 } == [false, true])
        let sent = StubURLProtocol.requests(to: route).map { $0.headers["Authorization"] ?? $0.headers["authorization"] ?? "" }
        #expect(sent == ["Bearer stale", "Bearer fresh"])
    }
}
