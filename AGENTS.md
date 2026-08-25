# Feed Reader — codebase guide

Single-user feed reader: TanStack Start web app on Vercel + Neon Postgres, a SwiftUI macOS client (`macos/`, see `macos/README.md`) and a remote MCP endpoint. The server is the source of truth; every client writes through to it.

## Dev workflow

- `pnpm deps:up` starts Postgres + pgweb in Docker and writes `POSTGRES_URL` / `TEST_DATABASE_URL` (Docker-assigned ports) into `.env.docker`. The dev, test and db scripts load it; never hardcode ports.
- `pnpm dev` runs Vite behind portless at `https://feedreader.localhost` (`apps/web/portless.json`); worktrees get `https://<branch>.feedreader.localhost`. Escape hatch: `cd apps/web && pnpm exec vite dev --port 3000`.
- A fresh clone runs with no `.env.local` (dev defaults in `apps/web/lib/env.ts`). `.env.example` lists every optional variable; `docs/deploy.md` explains them.

## Stack

TanStack Start (Vite + Nitro, SSR) · TanStack Router (file-based) · TanStack Query + oRPC (contract-first) · BetterAuth (email/password, OTP, optional Google, API keys, OAuth 2.1 provider for the macOS app and MCP clients) · Postgres 17 + Drizzle · Tailwind v4 + shadcn/ui + Radix · Turborepo + pnpm · oxlint + oxfmt · Vercel. Sentry, PostHog and Axiom are wired but disabled without keys.

## Commands

```bash
pnpm dev | build | preview
pnpm test                  # apps/web: vitest unit (real Postgres) + frontend (happy-dom)
pnpm test:db:migrate       # once after deps:up: migrate TEST_DATABASE_URL
pnpm test:e2e              # Playwright (apps/web/e2e)
pnpm lint | lint:fix | format | format:check | type-check | knip
pnpm db:generate | db:migrate | db:seed | db:reset | db:studio
```

## Layout

```
apps/web/
  app/routes/        TanStack file routes (UI + /api/* server routes)
  app/server-fns/    createServerFn helpers (auth, instance config)
  components/        ui/ (shadcn), providers/, shared/
  hooks/, lib/       client + server utilities (env, auth, orpc, email, bearer)
  server/routes/     oRPC route wiring (base.ts: pub / authed middleware)
  server/usecases/   business logic + authorization (tests live here)
  server/repos/      pure Drizzle queries
  server/lib/        feed fetching/parsing, OPML, inbound e-mail, cron helpers
  server/mcp/        MCP server on top of the usecases
  tests/             setup (per-test rolled-back transaction), factories, fixtures
packages/db          Drizzle schema + migrations (drizzle/*.sql, committed)
packages/api         oRPC contract (@orpc/contract + zod)
packages/query       typed client + TanStack Query hooks (docs/patterns.md)
macos/               SwiftUI app, SQLite mirror, snapshot tests
```

## Server layering

```
Route (oRPC)  →  Usecase (auth + orchestration)  →  Repo (database queries)
server/routes/     server/usecases/                   server/repos/
```

- **Routes**: thin wiring from the contract to usecases; authentication only (`pub` / `authed`).
- **Usecases**: business rules and **authorization**; orchestrate repos; the layer tests target.
- **Repos**: take a `db` handle, return rows; no auth, no side effects.

Adding a domain: schema in `packages/db/src/schema/<domain>.ts` → `pnpm db:generate` → contract in `packages/api/src/contracts/` → repo → usecase (+ `.test.ts`) → route (add to `server/routes/index.ts`) → hooks in `packages/query` → UI route.

## Auth

- Server instance: `auth` in `lib/auth.ts`; helpers `getAuthUserId()` / `getServerUser()` in `server/auth.ts`, exposed to the UI via `app/server-fns/auth.ts`.
- Client: `useSessionContext()` (one `useSession` subscription), `signIn` / `signUp` / `signOut` from `lib/auth-client.ts`.
- oRPC `authed` middleware accepts a session cookie or a Bearer token (OAuth access token or API key, `lib/bearer.ts`) and resolves both to `userId`; downstream code does not care which.
- Sign-up policy (`server/usecases/signup.ts`, enforced by the `user.create.before` hook in `lib/auth.ts`): open while the instance has no users, with `ALLOW_SIGNUP=true`, or with a valid invite (cookie `fr_invite` set by `/sign-up?invite=`). Admins (`ADMIN_EMAILS`, else the first account; `server/usecases/admin.ts`) manage users and invites from Settings › Admin through the `admin.*` oRPC routes (`admin` middleware in `server/routes/base.ts`). `GOOGLE_CLIENT_ID` toggles the Google button.

## Testing

- `tests/setup.ts` opens a transaction before each unit test and rolls it back after; `getTestDb()` returns the scoped handle. `tests/factories.ts` inserts real rows with overridable defaults.
- Frontend tests (`*.test.tsx`, happy-dom) use `vitest.frontend.config.ts`; `pnpm test` runs both configs.
- `vitest.config.ts` loads `.env.docker` and `.env*` from the repo root; variables already set (CI) win.

## Conventions

- UUID primary keys, `snake_case` columns (Drizzle `casing: "snake_case"`), zod on every input, JSONB types in `packages/db/src/types.ts`.
- No raw form elements or `window.confirm`: shadcn `Button`, `Dialog`, `Input`; `toast` from sonner; `Skeleton` for loading.
- No `useEffect` for derived state (oxlint plugin `tooling/oxlint-plugin-no-use-effect`); `useMountEffect` for real mount-only work.
- oxfmt formatting (tabs, double quotes); `pnpm lint:fix` before committing. Comments explain _why_, never narrate _what_.
- Conventional commits; one change per PR.

## Deployment

`apps/web/vercel.json` (Root Directory `apps/web`):

```json
"installCommand": "corepack enable && pnpm install --frozen-lockfile",
"buildCommand": "cd ../.. && if [ \"$VERCEL_ENV\" = \"production\" ]; then pnpm db:migrate; fi && pnpm build"
```

Migrations run only on production builds; previews share the production database unless given their own `POSTGRES_URL`. Crons (`/api/cron/refresh`, authenticated with `CRON_SECRET`) are declared in the same file. CI (`.github/workflows/ci.yml`) runs secrets scan, lint/format/type-check/knip, unit + frontend tests against Postgres, Playwright e2e and a build; `macos.yml` runs swift-format and `swift test`.
