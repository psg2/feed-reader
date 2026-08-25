#!/usr/bin/env bash
# List (or delete with --force) all Neon database branches except "main".
# Useful for cleaning up preview-deploy branches that pile up.
#
# Usage:
#   pnpm db:prune-branches              # list non-main branches
#   pnpm db:prune-branches:force        # delete them
#
# Requires:
#   - NEON_PROJECT_ID env var (find via `neonctl projects list`)
#   - jq, column (preinstalled on macOS / standard linux)
#   - neonctl: fetched on-demand via `pnpm dlx`, no install needed

set -euo pipefail

: "${NEON_PROJECT_ID:?NEON_PROJECT_ID env var required — find via 'pnpm dlx neonctl projects list'}"

force=0
if [[ "${1:-}" == "--force" ]]; then
  force=1
fi

branches=$(pnpm dlx neonctl branches list --project-id "$NEON_PROJECT_ID" -o json)

if [[ $force -eq 0 ]]; then
  echo "$branches" | jq -r '.[] | select(.name != "main") | "\(.id)\t\(.name)\t\(.created_at)\t\(.current_state)"' | column -t -s $'\t'
  exit 0
fi

echo "$branches" | jq -r '.[] | select(.name != "main") | .id' | while read -r id; do
  echo "→ deleting $id"
  pnpm dlx neonctl branches delete "$id" --project-id "$NEON_PROJECT_ID" >/dev/null && echo "  ✓ deleted"
done
