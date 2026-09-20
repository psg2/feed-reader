# Self-hosting Feed Reader

This guide takes a fork of the repository to a running instance on Vercel with a Neon Postgres database, then connects the optional pieces (Google sign-in, e-mail, newsletters, the MCP endpoint and the macOS app). Everything here is what the reference deployment uses; nothing requires a paid plan.

Feed Reader is a **small-instance** application: each account owns its own feeds, items, notes and tags; the newsletter webhook delivers to the first account; the crons refresh all feeds. Registration is invite-only by default: the first account can always be created, after that you invite people from **Settings › Admin** (or open registration with `ALLOW_SIGNUP=true`).

## 1. Prerequisites

- **Node 24** (`.github/workflows/ci.yml` and the Vercel build use 24).
- **pnpm 12** — the exact version is pinned in `package.json` (`packageManager`); `corepack enable` picks it up.
- **Docker** (Desktop or compatible) for the local Postgres.
- **Git + GitHub account** to fork the repository and connect it to Vercel.
- **Vercel account** (Hobby is enough) and, through the Vercel Marketplace, a **Neon** database.
- For the macOS app: macOS 15+, Xcode Command Line Tools with Swift 6 (full Xcode only for `make test`).

## 2. Local development

```bash
git clone https://github.com/<you>/feed-reader.git
cd feed-reader
corepack enable
pnpm install
pnpm deps:up        # Postgres + pgweb in Docker; writes .env.docker
pnpm db:migrate     # apply packages/db/drizzle/*.sql
pnpm dev            # https://feedreader.localhost (portless proxy)
```

Notes:

- `pnpm deps:up` binds containers to Docker-assigned ports and writes `POSTGRES_URL` and `TEST_DATABASE_URL` into `.env.docker`. Do not hardcode those values.
- `pnpm dev` runs behind portless: the first run creates a local CA and asks to trust it and to bind port 443. To skip that, `cd apps/web && pnpm exec vite dev --port 3000` (then set `BETTER_AUTH_URL=http://localhost:3000` in `.env.local`).
- Dev-only defaults for `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are baked into `apps/web/lib/env.ts`, so a fresh clone runs with no `.env.local`. Copy `.env.example` to `.env.local` only to enable optional integrations locally.
- Without `RESEND_API_KEY`, sign-up verification codes are printed to the dev server console.
- Tests: `pnpm test:db:migrate` once (creates the schema in `TEST_DATABASE_URL`), then `pnpm test`.

## 3. Create the Vercel project

1. Fork the repository on GitHub.
2. In Vercel: **Add New → Project → Import** your fork.
3. Set **Root Directory** to `apps/web`. Leave the framework preset on auto-detect (the app is TanStack Start built by Vite; Nitro emits the Vercel output). The install and build commands come from `apps/web/vercel.json` and do not need to be typed in the dashboard:

   ```json
   "installCommand": "corepack enable && pnpm install --frozen-lockfile",
   "buildCommand": "cd ../.. && if [ \"$VERCEL_ENV\" = \"production\" ]; then pnpm db:migrate; fi && pnpm build"
   ```

   On **production** builds the Drizzle migrations run against `POSTGRES_URL` **before** the build, so every production deploy leaves the database at the schema the code expects. Preview builds skip the migration step (they usually share the production database; see the note at the end of this guide). Migration `0004_seed_macos_oauth_client.sql` also seeds the first-party `feedreader-macos` OAuth client the native app relies on.

4. Do not deploy yet — add the database and environment variables first (steps 4 and 5), then trigger the first deploy. If Vercel already kicked off a build, it will fail on the missing `POSTGRES_URL`; just redeploy afterwards.

Every push to `main` deploys to production and every pull request gets a preview deployment once the GitHub integration is connected. Preview deployments share the production database unless you give them their own `POSTGRES_URL` (a Neon branch works well).

## 4. Neon Postgres

1. In the Vercel project: **Storage → Create Database → Neon** (Vercel Marketplace). Accept the defaults; choose a region close to your Vercel function region.
2. Connect it to the project for the **Production** (and optionally Preview) environment. The integration injects `POSTGRES_URL` along with a few sibling variables (`DATABASE_URL`, `POSTGRES_PRISMA_URL`, …). Only `POSTGRES_URL` is read by the app.
3. No extensions or manual setup are needed: the migrations under `packages/db/drizzle/` create everything, including the seeded OAuth client. Any Postgres 16+ works if you would rather not use Neon; only `POSTGRES_URL` changes.

## 5. Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (Production; repeat for Preview if you use it). `apps/web/lib/env.ts` is the authoritative schema; `env-sync.example.yaml` shows how to manage them from 1Password with [env-sync](https://github.com/psg2/env-sync) if you prefer that to the dashboard.

### Required

| Variable             | Value                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_URL`       | Set by the Neon integration.                                                                                                                                                            |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` — at least 32 characters; production refuses to start with the dev default.                                                                                      |
| `BETTER_AUTH_URL`    | The public URL of the instance, no trailing slash: `https://reader.example.com` (or the `*.vercel.app` URL until you add a domain). It is the only trusted origin and the OAuth issuer. |
| `CRON_SECRET`        | `openssl rand -hex 32`. Vercel sends it as `Authorization: Bearer <CRON_SECRET>` when invoking crons; `/api/cron/refresh` answers 401 without it.                                       |

### Registration

| Variable       | Value                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ALLOW_SIGNUP` | Optional, default `false`. The first account can always be created; after that, new users need an invitation from **Settings › Admin**. Set the string `true` to let anyone register.                                                       |
| `ADMIN_EMAILS` | Optional, comma-separated e-mails of the accounts that see **Settings › Admin** (invite users, revoke invitations, remove accounts). When unset, the earliest-created account is the admin. A user is only ever removable by another admin. |

Invitations are links (`https://<host>/sign-up?invite=…`) valid for 7 days and bound to the invited address; they are e-mailed when Resend is configured (below) and otherwise shown once to copy. Google sign-in honours the same rule: an invited address can use "Continue with Google" from the invite link.

`BETTER_AUTH_URL` also drives the OAuth `validAudiences` (`<url>/api/mcp`, `<url>/api/auth`), so MCP clients and the macOS app break if it does not match the host they talk to. Change it when you attach a custom domain.

### Optional: Google sign-in

1. [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) → **Create credentials → OAuth client ID → Web application**.
2. Authorized JavaScript origin: `https://<host>`.
3. Authorized redirect URI: `https://<host>/api/auth/callback/google` (BetterAuth is mounted at `/api/auth` by `apps/web/app/routes/api/auth.$.tsx`; `callback/<provider>` is its standard path).
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The sign-in page always shows the Google button; without these two variables it errors, so tell your users to use e-mail or configure it before sharing the link.

`OAUTH_PROXY_URL` is only for routing preview-deployment callbacks through a [better-auth oauth-proxy](https://github.com/better-auth/oauth-proxy); leave it unset.

### Optional: transactional e-mail (Resend)

Sign-up verification, passwordless sign-in and 2FA codes are sent through [Resend](https://resend.com). Without `RESEND_API_KEY` production logs a warning at startup and codes are only printed to the function logs, which is workable for the very first sign-up but not for daily use.

1. Add and verify your domain in Resend (DNS records for DKIM/SPF).
2. Create an API key with **Sending access** → `RESEND_API_KEY`.
3. `EMAIL_FROM="Feed Reader <reader@example.com>"` — the address must be on the verified domain.

### Newsletters

Nothing to deploy: create an inbox at [kill-the-newsletter.com](https://kill-the-newsletter.com), subscribe to the newsletter with the address it gives you, and add the inbox's feed URL to Feed Reader. Feeds on that host get the envelope icon and the Newsletters section in the sidebar, in the web app and on macOS.

### Optional: newsletters via Resend Receiving

If you would rather the server receive mail itself (own domain, inline images and attachments kept, no third party between you and the sender), set up Resend Receiving. Same limits as sending on the free plan.

Any e-mail sent to `<anything>@<INBOUND_EMAIL_DOMAIN>` becomes an item in a feed named after the sender, under the **Newsletters** category. Use a dedicated subdomain so the MX record does not interfere with your regular mail.

1. In Resend: **Domains → Add domain** `news.example.com` with **Receiving** enabled, and add the MX record it shows (plus the sending records if you also send from it).
2. **Webhooks → Add webhook** → endpoint `https://<host>/api/webhooks/resend`, event `email.received`. Copy the signing secret (`whsec_…`).
3. Set:
   - `RESEND_WEBHOOK_SECRET` — the Svix signing secret; signatures are verified before anything is stored.
   - `INBOUND_EMAIL_DOMAIN=news.example.com` — mail addressed to other domains is ignored.
   - `RESEND_API_KEY` must also be set (with permission to read received e-mails): the webhook payload carries only metadata and the body is fetched from the Received Emails API.
4. Subscribe to newsletters with e.g. `weekly@news.example.com`. Each sender address is its own feed (`mailto:<sender>`); rename it in the UI if you like.

Quota (Resend free plan at the time of writing): 3 domains, 100 e-mails/day and 3,000/month — a single counter shared between sending and receiving. A handful of newsletters fits comfortably; check [resend.com/pricing](https://resend.com/pricing) for current limits.

### Optional, off by default

These are recognised by `apps/web/lib/env.ts` and simply disable their feature when absent:

- **Sentry** (`VITE_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) — error tracking and source-map upload.
- **PostHog** (`VITE_PUBLIC_POSTHOG_KEY`, optional `VITE_PUBLIC_POSTHOG_HOST`) — analytics; events go through the `/ingest` rewrite in `vercel.json`.
- **Axiom** (`VITE_PUBLIC_AXIOM_TOKEN`, `VITE_PUBLIC_AXIOM_DATASET`) — logging.
- `SLOW_QUERY_MS` — log Postgres queries slower than this many milliseconds (default `200`).
- `ALLOW_PRIVATE_FEED_HOSTS=true` — **development only**: allow subscribing to feeds on `localhost` and private-network hosts. Never set it in production; the default blocks them to prevent the server from being used to reach internal services.
- `SKIP_ENV_VALIDATION=1` — skip schema validation at build time (CI uses it). Do not set it on Vercel.

## 6. Feed refresh crons

`apps/web/vercel.json` registers `/api/cron/refresh` twice, at 09:00 and 20:00 UTC:

```json
"crons": [
  { "path": "/api/cron/refresh", "schedule": "0 9 * * *" },
  { "path": "/api/cron/refresh", "schedule": "0 20 * * *" }
]
```

- Crons only run against the **production** deployment and only when `CRON_SECRET` is set.
- On the **Hobby** plan each cron is limited to **once per day** and the hour is best-effort. Either keep a single entry, or keep both and accept that Vercel may reject the second; on Pro you can use any schedule (for example `*/30 * * * *`).
- You can trigger a refresh manually at any time with `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/refresh`, from the web UI, or with ⌘R in the macOS app.

## 7. Custom domain

1. **Vercel → Project → Settings → Domains → Add** `reader.example.com` and create the CNAME/A record it asks for.
2. Update `BETTER_AUTH_URL` to `https://reader.example.com` and redeploy.
3. Update the Google redirect URI (step 5) and the MCP/macOS clients (steps 9 and 10) to the new host. OAuth tokens issued for the old host stop validating, so sign in again.

## 8. Alternative: deploy from GitHub Actions

If you prefer not to use the Vercel GitHub integration (or want deploys gated on CI), `.github/workflows/deploy.yml` deploys with the Vercel CLI on `workflow_dispatch`. Configure it once per fork:

```bash
gh variable set VERCEL_ORG_ID --body team_…       # Vercel → Settings → General
gh variable set VERCEL_PROJECT_ID --body prj_…    # Project → Settings → General
gh secret set VERCEL_TOKEN                        # https://vercel.com/account/tokens
```

The job skips itself while `VERCEL_TOKEN` is missing. It runs `vercel pull` + `vercel deploy --prod`, so migrations still run inside the Vercel build. To deploy on every push, change the trigger to `push: { branches: [main] }` and disable the Vercel integration's auto-deploy so you do not get two builds.

## 9. MCP clients

The server is a remote MCP endpoint with OAuth 2.1 (dynamic client registration is allowed, so any OAuth-capable MCP client can register itself without an API key). For Claude Code:

```bash
claude mcp add --transport http --scope user feedreader https://<host>/api/mcp
```

The first request opens the browser for a one-time consent. Other clients: give them `https://<host>/api/mcp`; discovery happens through `/.well-known/oauth-protected-resource/api/mcp` and `/.well-known/oauth-authorization-server`. Scripts can use an API key created in the web app's Settings page as the bearer token instead.

## 10. macOS app

The app defaults to the reference server, so point it at yours before signing in:

```bash
defaults write dev.sereno.feedreader remoteServerURL https://<host>
```

The sign-in screen also has a **server URL** field, so you can type the address there instead of using `defaults`. Either way the value is stored per host, and Sign Out plus a new URL switches instances.

Build and install from a checkout:

```bash
cd macos
make install     # release build → ~/Applications/FeedReader.app (ad-hoc signed)
```

`make run` starts a debug build from the terminal; `make ci` runs the linter and tests (needs full Xcode). The app signs in through your default browser using the `feedreader-macos` OAuth client seeded by migration 0004, so there is nothing to register on the server. See [`macos/README.md`](../macos/README.md) for keyboard shortcuts and behaviour.

## 11. First run

1. Open `https://<host>/sign-up`, create your account and enter the verification code (from your inbox, or from the Vercel function logs if e-mail is not configured yet). The first account is created regardless of `ALLOW_SIGNUP`.
2. Registration is now closed to strangers. To add someone, open **Settings › Admin** and invite their e-mail: they receive a link (or you copy it) that is valid for 7 days. Set `ALLOW_SIGNUP=true` instead if you want open registration.
3. Add feeds: paste site or feed URLs (one per line) in the web UI or with ⌘N in the macOS app; the server resolves site URLs to their feed. Categories and tags are created inline. To bring an existing subscription list, import an OPML file from **Settings** in the web UI (`POST /api/opml`) or **File → Import OPML…** in the macOS app.
4. Run a refresh (⌘R, the UI button, or the cron `curl` above) to fetch the first items.
5. Optionally connect an MCP client (step 9) and the macOS app (step 10).

## Updating

```bash
git fetch upstream && git merge upstream/main   # or rebase your fork
git push origin main                            # Vercel builds, migrates, deploys
```

Migrations run at the start of every **production** build, before the new code goes live. Read `packages/db/drizzle/` in the diff before pushing a big update; if a migration fails, the build fails and the previous deployment stays up. Locally run `pnpm install && pnpm db:migrate` after pulling.

## Backups

Neon keeps a point-in-time history of every branch (7 days on the free plan, configurable up to 30 on paid plans under **Project settings → History retention**). To recover: **Branches → Restore** to a timestamp, which creates a branch you can inspect and promote, or point `POSTGRES_URL` at it. For an off-site copy, run `pg_dump "$POSTGRES_URL" > feedreader.sql` on a schedule from your machine or a GitHub Actions cron.

The macOS SQLite mirror (`~/Library/Application Support/FeedReader/feedreader.sqlite`) is a cache, not a backup: it is wiped on Sign Out and rebuilt from the server.

## Troubleshooting

- **Build fails with `POSTGRES_URL` invalid** — the Neon integration is not connected to the environment being built, or the variable is empty.
- **Refusing to start: `BETTER_AUTH_SECRET is the dev default`** — set a real secret (step 5).
- **`requested resource invalid` from an MCP client** — the client uses a host that differs from `BETTER_AUTH_URL`; check the `validAudiences` note above.
- **Cron returns 401** — `CRON_SECRET` is not set on production, or you invoked a preview URL.
- **Webhook returns 503 `Inbound e-mail not configured`** — `RESEND_WEBHOOK_SECRET` or `RESEND_API_KEY` is missing.
- **Sign-up fails after the first account** — registration is invite-only by default; invite the address from **Settings › Admin** or set `ALLOW_SIGNUP=true`.
- **No Admin section in Settings** — you are not an admin: either your e-mail is not in `ADMIN_EMAILS`, or (with it unset) yours is not the earliest-created account.

> **Migrations run only on production builds.** Preview deployments share the production `POSTGRES_URL` unless you give them their own database (for example a Neon branch per preview), so `apps/web/vercel.json` guards `pnpm db:migrate` behind `VERCEL_ENV=production`. A preview whose PR adds a migration will run against the old schema until it is merged.
