#!/bin/sh
# Vercel's Ignored Build Step: exit 0 skips the deployment, anything else builds.
# Compares against the last successful deployment, not HEAD^, so a push that
# lands a code commit followed by a docs commit still deploys. When that commit
# is missing from Vercel's shallow clone (a redeploy of an older commit), git
# diff exits 128, which Vercel reports as a failed deployment instead of
# building, so every non-zero status becomes 1.
# Redeploying the same commit is how changed environment variables reach a
# deployment, and a branch with no successful deployment yet has no previous
# SHA, so both always build.
cd "$(dirname "$0")/.." || exit 1
base="${VERCEL_GIT_PREVIOUS_SHA:-}"
[ -n "$base" ] || exit 1
[ "$(git rev-parse "$base" 2>/dev/null)" = "$(git rev-parse HEAD)" ] && exit 1
git diff --quiet "$base" HEAD -- . \
	':(exclude)*.md' \
	':(exclude)docs' \
	':(exclude).claude' \
	':(exclude).agents' \
	':(exclude).github' \
	':(exclude).design-sync' \
	':(exclude)apps/web/e2e' \
	':(exclude)*.test.ts' \
	':(exclude)*.test.tsx' \
	':(exclude)lefthook.yml' \
	':(exclude)skills-lock.json' || exit 1
