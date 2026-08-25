# Feed Reader (macOS)

Native SwiftUI client for the Feed Reader server. The server owns the data; the app keeps a SQLite mirror so it opens instantly and stays readable offline, and pushes every action (read, star, notes, tags, feeds) back through the API.

## Layout

```
Sources/FeedReaderCore   models, GRDB database + migrations, OAuth client + token store, oRPC client (RemoteAPI), SyncEngine, HTML sanitizer
Sources/FeedReaderUI     SwiftUI views + models (SidebarModel, ItemListModel, ItemDetailModel), AppState (session, sync timer, actions)
Sources/FeedReaderApp    @main, menu commands, settings
Tests/FeedReaderCoreTests  unit tests (OAuth, sync queue, HTML sanitizer, OPML, mirror recovery) with a URLProtocol stub for the server
Tests/FeedReaderUITests    model, queue and web view tests + light/dark snapshot tests (baselines in __Snapshots__)
```

Mirror database: `~/Library/Application Support/FeedReader/feedreader.sqlite` (WAL mode). It is disposable: a file that cannot be opened is renamed `feedreader.sqlite.corrupt-<timestamp>` and rebuilt from the next pull.

### Token storage

Session tokens live in `session-<host>.json` next to the mirror, a JSON file with mode 0600. That is not the keychain, on purpose: the app is ad-hoc signed, so every rebuild would prompt for the login keychain password. The trade-off is that any process running as your user can read the file, and it travels with backups (Time Machine, or wherever `~/Library/Application Support` goes). Access tokens expire within the hour; the refresh token lasts a year until you sign out (which revokes it) or the server rejects it. Do not use the app on a shared account.

## Run

```sh
make run        # swift run, debug
make install    # release build → ~/Applications/FeedReader.app
```

Requires macOS 15 or later and a Swift 6 toolchain (Xcode 16 or newer; the package is in the Swift 6 language mode with strict concurrency checking). Building works with Command Line Tools only; `make test` needs Xcode selected (`sudo xcode-select -s /Applications/Xcode.app`). Delete a PNG under `__Snapshots__` to re-record that snapshot.

### Signing

There is no notarized download. `make install` builds a release binary, wraps it in a minimal `.app` and ad-hoc signs it (`codesign --sign -`), which is enough for an app you built on the machine that runs it. Gatekeeper will refuse the same bundle copied to another Mac.

### Development

`swift run` (or `make run`) starts the app without a bundle, so the `feedreader://` URL scheme is not registered by that process: after "Sign in with Browser", macOS hands the callback to whichever _installed_ FeedReader.app owns the scheme. Run `make install` once so an installed copy exists; the debug build then reads the session file the installed app wrote (both use the same Application Support folder), or sign in through the installed app first.

The app talks to `https://reader.sereno.dev.br` by default. That is the author's instance and sign-ups there are closed, so either run your own server (see the repository root) and put its address in the **Server** field on the sign-in screen, or ask for an account. The field accepts https only, except `http://localhost`, `http://*.localhost` and `http://127.0.0.1` for development. The choice is stored in the `remoteServerURL` default, so the command-line override still works too:

```sh
defaults write dev.sereno.feedreader remoteServerURL https://feedreader.localhost
```

The server can only be changed while signed out: the session file and the mirror belong to one host. Settings › Account shows which server you are on.

## Sign in

"Sign in with Browser" opens the server's sign-in page in your default browser (email/password or Google) and comes back through the `feedreader://oauth/callback` URL scheme (authorization code + PKCE against the first-party `feedreader-macos` OAuth client, which skips the consent screen). Refresh tokens last a year; when the server rejects one, the app returns to the sign-in screen. Sign Out revokes the grant and wipes the mirror.

## Sync

Pull from the server on launch, every N minutes (Settings › Sync › "Check for updates", default 15) and when the app becomes active after a minute away. There is one **Refresh** (⌘R, `r`, toolbar, ⋯ menu, Settings › Refresh Now): it asks the server to fetch every feed and then pulls.

Local writes go to SQLite first (so the UI never waits) and into the `pending_ops` table, an offline queue that `SyncQueue` drains in order: right after each write, when the app becomes active, before every pull (so the server's dump never overwrites a write it has not received yet; anything still queued is also replayed on top of the pulled state), and on a retry timer with exponential backoff (10 s doubling up to 5 min) after a failure. A later read/unread, star, notes, tags or full-page change for the same row replaces the queued one. Ops survive restarts. A transient failure (offline, 5xx, 401/408/429) keeps the op and stops the drain; a definitive 4xx or an answer the client cannot decode drops it; a 5xx/429 that keeps coming back is dropped after 8 attempts (being offline never counts); an expired session stops the drain and returns to the sign-in screen with the queue intact. Sign Out wipes the queue with the mirror.

Background failures never open a dialog. The account footer's sync line reads "Updated 2m ago", "3 changes pending · Retry" while the queue is non-empty, or "Couldn't sync · Retry" after a failed pull/push/refresh (the reason is in its tooltip) until the next success. Retry pushes the queue and pulls again. Only things you just asked for (add feed, OPML import) alert on failure.

## Behaviour

- Selecting a post does **not** mark it read. ⌘U toggles read, ⌘D toggles star, ⇧⌘O opens in the browser, ⇧⌘K marks the current view as read. A post you just marked read stays in the Unread list until you select something else. Read/star/mark-all are undoable: ⌘Z or the toast at the bottom of the list.
- **Add feed** (+, `a`, ⌘N) takes one URL per line; the server resolves site or post URLs to their feed. With no feeds yet, the list and the sidebar point to Add Feed… and Import OPML….
- **OPML**: File › Import OPML… subscribes to every `<outline xmlUrl>` (folders become categories) through the server and reports `Imported 12 feeds (2 already subscribed, 1 failed)`; File › Export OPML… writes the mirror's feeds grouped by category.
- **Newsletters** (feeds whose address is `mailto:` or a kill-the-newsletter.com inbox) get an envelope icon and their own sidebar section.
- **Pause** (feed context menu) tells the server to stop fetching a feed but keeps its posts; paused feeds show dimmed with a pause glyph. **Unsubscribe** asks first, with the number of posts (and posts with notes) that will be deleted everywhere.
- `W` loads the post's full web page in the reader instead of the feed content; a feed can be set to always do that via its context menu ("Always Load Full Page").
- **Notes and tags** autosave. The caption next to "Notes" reads "Saving…" → "Saved" (fades), "Saved on this Mac · syncing later" while the push waits behind a network failure, or "Couldn't save · Retry" when the server refused it. Tags are chips: Enter or comma adds, Backspace in the empty field removes the last one, typing suggests existing tags.
- Feed HTML is sanitized before being rendered (`HTMLText.sanitized`: scripts, styles, frames, objects, forms, SVG, `<base>`/`<link>`/`<meta>`, `on*` handlers and non-http(s) URLs are removed; images with http(s) sources stay) and shown in a WKWebView with JavaScript off and a non-persistent data store. The full web page (`W`) runs the site's own scripts, also in a non-persistent store. Links open in the default browser in both modes.

## Keyboard

Same table as the web. Single keys work whenever a text field is not focused: `j`/`k` next/previous · `e` mark read and go next · `u` toggle read · `s` toggle star · `o` open in browser · `w` full web page · `n` edit notes · `/` search · `esc` back to list · `?` shortcuts sheet · `a` add feed · `r` refresh. Commands: ⌘K palette, ⇧⌘K mark all as read, ⌘1/2/3 Unread/All/Starred, ⌘R refresh, ⌘N add feed, ⌘Z undo, ⌘, settings (⌘U/⌘D/⇧⌘O also exist in the menu bar). Tooltips show the single letter; the ⌘ variants appear only in the menu bar. ⌘K opens the command palette: every action plus feeds, tags and posts matching what you type. All actions live in `Sources/FeedReaderUI/Actions.swift` (`AppAction`), which feeds the key router, the sheet, the hint bar and the palette.

## License

MIT (see [../LICENSE](../LICENSE)).

## CI

`.github/workflows/macos.yml` runs on every PR/push touching `macos/`: `make lint` (swift-format, config in `.swift-format`), release build and `swift test` on a macOS runner. Run the same locally with `make ci`; `make format` rewrites files to the house style.
