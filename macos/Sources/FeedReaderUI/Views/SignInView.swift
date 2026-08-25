import FeedReaderCore
import SwiftUI

/// First screen until there is an account: the app has no state of its own.
public struct SignInView: View {
    @EnvironmentObject var state: AppState
    @State private var server = ""
    @State private var serverError: String?
    @FocusState private var serverFocused: Bool

    public init() {}

    public var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Image(nsImage: NSApplication.shared.applicationIconImage)
                .resizable()
                .frame(width: 96, height: 96)
            Text("Feed Reader")
                .font(.system(size: 26, weight: .semibold))
                .padding(.top, 14)
            Text("Your feeds, notes and tags live on \(state.serverURL.host ?? "the server").\nSign in and they show up here.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.top, 6)
            HStack(spacing: 6) {
                Text("Server").foregroundStyle(.secondary)
                TextField("https://reader.example.com", text: $server)
                    .textFieldStyle(.roundedBorder)
                    .focused($serverFocused)
                    .onSubmit { applyServer() }
                    .disabled(state.isSigningIn)
            }
            .font(.callout)
            .frame(width: 320)
            .padding(.top, 20)
            .onChange(of: serverFocused) { _, focused in if !focused { applyServer() } }
            if let serverError {
                Text(serverError).font(.caption).foregroundStyle(.red).multilineTextAlignment(.center).frame(maxWidth: 360)
                    .padding(.top, 4)
            }
            Button {
                if applyServer() { state.signIn() }
            } label: {
                HStack(spacing: 8) {
                    if state.isSigningIn { ProgressView().controlSize(.small) }
                    Text(state.isSigningIn ? "Waiting for the browser…" : "Sign in with Browser")
                }
                .frame(minWidth: 220)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)
            .disabled(state.isSigningIn)
            .padding(.top, 16)
            if state.isSigningIn {
                Button("Cancel") { state.cancelSignIn() }.buttonStyle(.link).padding(.top, 8)
            }
            if let error = state.signInError {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.top, 12)
                    .frame(maxWidth: 360)
            }
            Spacer()
            Text("Opens your browser; email or Google, whatever you use on the web.\nRunning your own server? Put its address above.")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .padding(.bottom, 18)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
        .onAppear { server = state.serverURL.absoluteString }
    }

    /// Commits the field to `AppState`; false (with the reason shown) when the address is rejected.
    @discardableResult
    private func applyServer() -> Bool {
        do {
            try state.configureServer(server)
            server = state.serverURL.absoluteString
            serverError = nil
            return true
        } catch {
            serverError = error.localizedDescription
            return false
        }
    }
}
