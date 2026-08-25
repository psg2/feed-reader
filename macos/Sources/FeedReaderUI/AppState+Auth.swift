import AppKit
import FeedReaderCore
import Foundation
import GRDB
import WebKit

/// Who is signed in, as reported by the server's userinfo endpoint.
public struct Profile: Codable, Equatable, Sendable {
    public var name: String
    public var email: String
    public var picture: String?
}

/// Sign-in, sign-out and the server session. The server is the source of
/// truth: the local SQLite database is only a mirror that makes the app open
/// instantly and keeps working offline.
extension AppState {
    /// Opens the sign-in page in the user's default browser (their Google
    /// session included) and waits for the browser to come back through the
    /// `feedreader://oauth/callback` URL registered in Info.plist. No system
    /// "wants to use … to sign in" dialog: the first-party OAuth client has
    /// no consent screen either, so it is one click in the browser.
    public func signIn() {
        let pkce = OAuthClient.PKCE.make()
        pendingSignIn = pkce
        isSigningIn = true
        signInError = nil
        NSWorkspace.shared.open(oauth.authorizeURL(pkce))
    }

    /// The user gave up waiting for the browser.
    public func cancelSignIn() {
        pendingSignIn = nil
        isSigningIn = false
    }

    /// Entry point for `feedreader://…` URLs handed to the app by the browser.
    public func handle(url: URL) {
        guard url.scheme == OAuthClient.callbackScheme, url.host == "oauth", let pkce = pendingSignIn else { return }
        pendingSignIn = nil
        NSApplication.shared.activate(ignoringOtherApps: true)
        Task { await completeSignIn(callback: url, pkce: pkce) }
    }

    func completeSignIn(callback: URL, pkce: OAuthClient.PKCE) async {
        do {
            let code = try oauth.code(from: callback, expecting: pkce)
            let issued = try await oauth.exchange(code: code, pkce: pkce)
            await tokens.set(issued)
            profile = try? await fetchProfile(accessToken: issued.accessToken)
            isSignedIn = true
            await syncNow()
            await refreshAll()
        } catch {
            signInError = error.localizedDescription
        }
        isSigningIn = false
    }

    /// Revokes the grant, forgets the tokens, drops the local mirror and whatever web content stored.
    public func signOut() async {
        retryTask?.cancel()
        if let current = await tokens.current() { await oauth.revoke(current) }
        await tokens.clear()
        try? db.wipe()
        // The web views use non-persistent stores, so this only catches what an older build left behind.
        await WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
        pendingCount = 0
        profile = nil
        selectedItemId = nil
        filter = .unread
        lastSync = nil
        syncError = nil
        isSignedIn = false
        reloadToken += 1
    }

    /// The server said the grant is gone (refresh token expired or revoked).
    /// The queue is kept: it drains once the user signs in again.
    func handleSignedOut() {
        guard isSignedIn else { return }
        retryTask?.cancel()
        isSignedIn = false
        signInError = OAuthError.signedOut.localizedDescription
    }

    private struct UserInfo: Decodable {
        let name: String?
        let email: String?
        let picture: String?
    }

    func fetchProfile(accessToken: String) async throws -> Profile {
        var request = URLRequest(url: serverURL.appendingPathComponent("api/auth/oauth2/userinfo"))
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "authorization")
        let (data, _) = try await session.data(for: request)
        let info = try JSONDecoder().decode(UserInfo.self, from: data)
        return Profile(name: info.name ?? info.email ?? "You", email: info.email ?? "", picture: info.picture)
    }

    // MARK: Server operations

    /// Routes auth failures to the sign-in screen; everything else to the footer's "Couldn't sync · Retry".
    func reportSyncFailure(_ error: Error) {
        if case OAuthError.signedOut = error {
            handleSignedOut()
        } else {
            syncError = error.localizedDescription
        }
    }

    func remoteItemIds(_ ids: [Int64]) -> [String] {
        (try? db.reader.read { sqlite in
            try Item.filter(ids.contains(Column("id"))).fetchAll(sqlite).compactMap(\.remoteId)
        }) ?? []
    }

    func remoteFeedId(_ id: Int64) -> String? {
        try? db.reader.read { try Feed.fetchOne($0, id: id)?.remoteId }
    }

    /// Pushes queued writes, then pulls the server state into the local mirror and refreshes the models.
    public func syncNow() async {
        guard isSignedIn else { return }
        await drainQueue()
        guard isSignedIn else { return }
        do {
            _ = try await SyncEngine.pull(api: remoteAPI, db: db)
            lastSync = now()
            syncError = nil
            pullFailed = false
            reloadToken += 1
        } catch {
            pullFailed = true
            reportSyncFailure(error)
        }
    }
}
