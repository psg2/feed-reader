import AppKit
import FeedReaderCore
import SwiftUI

/// ⌘, window. One grouped form: who is signed in, how often we sync, and the few local preferences.
public struct SettingsView: View {
    @EnvironmentObject var state: AppState
    @State private var signingOut = false

    private let intervals = [5, 15, 30, 60, 120]

    public init() {}

    public var body: some View {
        Form {
            Section {
                if let profile = state.profile {
                    LabeledContent("Signed in as") {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(profile.name)
                            Text(profile.email).font(.callout).foregroundStyle(.secondary)
                        }
                    }
                } else {
                    LabeledContent("Signed in as") { Text(state.isSignedIn ? "Loading…" : "Not signed in").foregroundStyle(.secondary) }
                }
                LabeledContent("Server") {
                    Link(state.serverURL.host ?? state.serverURL.absoluteString, destination: state.serverURL)
                }
                Button(signingOut ? "Signing out…" : "Sign Out…", role: .destructive) {
                    signingOut = true
                    Task {
                        await state.signOut()
                        signingOut = false
                    }
                }
                .disabled(signingOut || !state.isSignedIn)
            } header: {
                Text("Account")
            } footer: {
                Text("Signing out forgets this Mac's access and clears the local copy. Nothing on the server is touched.")
            }

            Section {
                Picker("Check for updates", selection: $state.refreshIntervalMinutes) {
                    ForEach(intervals, id: \.self) { m in Text(label(m)).tag(m) }
                }
                LabeledContent("Last updated") {
                    if let d = state.lastSync {
                        Text(RelativeText.string(from: d, now: state.now())).foregroundStyle(.secondary)
                    } else {
                        Text("Not yet").foregroundStyle(.secondary)
                    }
                }
                Button("Refresh Now") { Task { await state.refreshAll() } }.disabled(state.isRefreshing || !state.isSignedIn)
            } header: {
                Text("Sync")
            } footer: {
                Text(
                    "The server fetches your feeds twice a day and whenever you press ⌘R. "
                        + "The app checks for updates on this schedule and each time it becomes active.")
            }

            Section {
                Button("Show Keyboard Shortcuts…") { state.showShortcuts = true }
                Toggle(
                    "Show the shortcut hint bar under the list",
                    isOn: Binding(get: { !state.hintDismissed }, set: { state.hintDismissed = !$0 }))
            }

            Section {
                CopyableCommand("claude mcp add --transport http --scope user feedreader \(state.serverURL.absoluteString)/api/mcp")
            } header: {
                Text("Claude Code")
            } footer: {
                Text(
                    "Registers the reader as a remote MCP server. Ask Claude to summarize, compare or tag posts; "
                        + "it writes straight into your notes and tags.")
            }
        }
        .formStyle(.grouped)
        .frame(width: 560, height: 560)
    }

    private func label(_ m: Int) -> String {
        m < 60 ? "Every \(m) minutes" : m == 60 ? "Every hour" : "Every \(m / 60) hours"
    }
}

struct CopyableCommand: View {
    let command: String
    @State private var copied = false
    init(_ command: String) { self.command = command }

    var body: some View {
        HStack {
            Text(command).font(.callout.monospaced()).textSelection(.enabled).lineLimit(1).truncationMode(.middle)
            Spacer()
            Button(copied ? "Copied" : "Copy") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(command, forType: .string)
                copied = true
                Task {
                    try? await Task.sleep(for: .seconds(1.5)); copied = false
                }
            }
            .controlSize(.small)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .quaternarySystemFill)))
    }
}
