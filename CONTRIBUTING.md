# Contributing

Thanks for taking the time. Feed Reader is a small single-user project, so the process is light, but CI is strict.

## Development setup

Web (Node 24, pnpm, Docker):

```bash
corepack enable
pnpm install
pnpm deps:up        # Postgres + pgweb in Docker
pnpm db:migrate
pnpm dev            # https://feedreader.localhost (see README for the portless prompts)
```

macOS app (Swift 6, Command Line Tools; full Xcode for tests):

```bash
cd macos
make run
```

See [`docs/deploy.md`](docs/deploy.md) for the full environment reference and [`AGENTS.md`](AGENTS.md) / [`docs/patterns.md`](docs/patterns.md) for codebase conventions.

## Before opening a pull request

Web:

```bash
pnpm lint && pnpm format:check && pnpm type-check && pnpm knip
pnpm test                          # unit + frontend suites
```

`pnpm test` needs the test database: run `pnpm test:db:migrate` once after `pnpm deps:up`. `pnpm format` rewrites files to the house style.

macOS:

```bash
cd macos && make ci     # swift-format lint + swift test
```

`make format` rewrites Swift files to the house style. If a snapshot test changes on purpose, delete the PNG under `__Snapshots__` and re-run to re-record.

Optional but recommended: `brew install lefthook && lefthook install` runs the same gates on `git push`.

## Conventions

- **Conventional commits**: `feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `refactor:`, `test:`. Scope is optional (`feat(macos): …`).
- **One change per pull request.** Small, reviewable PRs merge fastest; unrelated refactors go in their own PR.
- Database changes: edit the schema in `packages/db/src/schema`, run `pnpm db:generate`, and commit the generated SQL. Migrations run automatically on production deploys.
- Do not add application dependencies without a short justification in the PR description.
- Fill in the pull request template; link the issue if there is one.

## Reporting bugs and proposing features

Use the issue templates. For security problems, do not open an issue — see [`SECURITY.md`](SECURITY.md).
