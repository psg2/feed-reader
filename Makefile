.PHONY: help cloc env env-local env-preview env-production env-dry-run scan-secrets

help: ## Show this help message
	@echo "Available recipes:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-25s\033[0m %s\n", $$1, $$2}'

cloc: ## Count lines of code (excludes build artifacts and node_modules)
	cloc . --exclude-dir=.output,node_modules,.turbo,.cache,.vercel,.build

# env-sync (https://github.com/psg2/env-sync) reads env-sync.yaml, which is
# gitignored: copy env-sync.example.yaml and fill in your vault/app names.
env: ## Sync all env targets (local + Vercel preview + production)
	@env-sync

env-local: ## Sync local .env.local from 1Password
	@env-sync local

env-preview: ## Push env vars to Vercel preview
	@env-sync preview

env-production: ## Push env vars to Vercel production
	@env-sync production

env-dry-run: ## Preview env sync without changes
	@env-sync --dry-run

scan-secrets: ## Scan for leaked secrets (requires gitleaks: brew install gitleaks)
	@gitleaks detect --source . -v
