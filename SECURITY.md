# Security policy

## Supported versions

Feed Reader is deployed from `main`; there are no tagged releases. Only the current `main` branch receives fixes.

## Reporting a vulnerability

Please report vulnerabilities privately through **GitHub Security Advisories**: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue or pull request for security problems.

If private reporting is not enabled on the repository (a fork, for example), contact the maintainer directly through the e-mail or links on their [GitHub profile](https://github.com/psg2). Maintainers of forks: enable **Settings → Code security → Private vulnerability reporting** so this section applies to your instance too.

Include what you can: affected component (web app, MCP endpoint, OAuth provider, webhook, macOS app), steps to reproduce, and impact. You will get an acknowledgement within a few days; fixes ship on `main` and are noted in the advisory once published.

## Scope notes

- The application is single-user by design. Reports about one user reaching another user's data still matter (the OAuth provider and MCP endpoint serve third-party clients), but multi-tenant isolation is not a goal.
- Third-party services (Vercel, Neon, Resend, Google) are out of scope; report those to the respective vendor.
