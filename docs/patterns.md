# Frontend Patterns

Conventions for working with the codebase. Read this once before
contributing UI or query/mutation code.

## 1. API client (`@feedreader/query`)

The `@feedreader/query` package exposes one **factory per domain** that bundles
query and mutation hooks. Each hook handles **cache invalidation
internally**; callers handle **UX** (toasts, navigation, form resets).

### Structure

```
packages/query/src/
├── client.ts          ← createApiClient(orpc) factory
├── cache.ts           ← addToArray, removeFromArray, replaceInArray
├── types.ts           ← OrpcUtils, MutationCallbacks, QueryExtra
└── domains/
    ├── posts.ts       ← createPostDomain(orpc) → { useList, useCreate, ... }
    └── ...            ← one file per domain
```

### Pattern: domain factory

Each domain file exports a single `create<Name>Domain(orpc)` function
that returns an object of hooks. Queries first, then mutations.

```ts
// packages/query/src/domains/posts.ts
"use client";

import type { PostItem } from "@feedreader/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cache } from "../cache";
import type { MutationCallbacks, OrpcUtils, QueryExtra } from "../types";

function listKey(orpc: OrpcUtils) {
	return orpc.posts.list.key({ input: undefined, type: "query" });
}

export function createPostDomain(orpc: OrpcUtils) {
	return {
		// ── Queries ────────────────────────────────────────────────────────
		useList: (options?: QueryExtra) =>
			useQuery({
				...orpc.posts.list.queryOptions({ input: undefined }),
				...options,
			}),

		useGet: (postId: string, options?: QueryExtra) =>
			useQuery({
				...orpc.posts.get.queryOptions({ input: { postId } }),
				...options,
			}),

		// ── Mutations ──────────────────────────────────────────────────────
		useCreate: (callbacks?: MutationCallbacks) => {
			const qc = useQueryClient();
			return useMutation({
				...orpc.posts.create.mutationOptions(),
				onSuccess: (created, variables) => {
					cache.addToArray<PostItem>({
						queryClient: qc,
						key: listKey(orpc),
						item: created,
					});
					callbacks?.onSuccess?.(created, variables);
				},
				onError: (err, variables) => {
					callbacks?.onError?.(
						err instanceof Error ? err : new Error(String(err)),
						variables,
					);
				},
				onSettled: callbacks?.onSettled,
			});
		},
	};
}
```

### Pattern: client factory

`createApiClient` composes all domains into one object the app imports.

```ts
// packages/query/src/client.ts
import { createPostDomain } from "./domains/posts";

export function createApiClient(orpc: OrpcUtils) {
	return {
		posts: createPostDomain(orpc),
		// add new domains here
	};
}
```

### Pattern: app instance

The app wires it once and re-exports.

```ts
// apps/web/lib/api.ts
import { createApiClient } from "@feedreader/query";
import { orpc } from "./orpc";

export const api = createApiClient(orpc);
```

### Pattern: caller provides UX callbacks

```tsx
const createPost = api.posts.useCreate({
	onSuccess() {
		toast.success("Post created");
		resetForm();
	},
	onError(err) {
		toast.error(err.message);
	},
});

createPost.mutate({ title, body });
```

For queries, `QueryExtra` lets the caller control `enabled`, `staleTime`,
`refetchInterval`, etc. without touching the domain hook.

```tsx
const { data } = api.posts.useGet(postId, { enabled: !!postId });
```

### Cache helpers vs invalidate

Prefer **direct cache updates** when the mutation response contains
enough data to reflect the new state:

- `cache.addToArray` — after `useCreate`
- `cache.replaceInArray` — after `useUpdate`
- `cache.removeFromArray` — after `useDelete`

Fall back to `queryClient.invalidateQueries({ queryKey: ... })` when the
mutation has cross-domain side effects (e.g., creating a post also
changes an activity feed) or when the server's response doesn't fully
capture the new list state.

### Rules

- **One factory per domain.** Co-locate queries and mutations.
- **Cache invalidation lives in the hook.** Never invalidate from a
  component.
- **UX lives in the caller.** No toasts, no `router.push`, no form
  state inside `@feedreader/query`.
- **Callbacks are composable.** Domain hooks always call the caller's
  `onSuccess`/`onError`/`onSettled` after their own cache work.
- **Types come from `@feedreader/api`.** Never import from server code inside
  client components or the query package.
- **No wrapper hooks in `apps/web`.** Components consume `api.<domain>.<hook>`
  directly. Don't add a `hooks/use-post-mutations.ts` layer.

## 2. Adding a new domain

1. Add the oRPC contract and router under `packages/api/`.
2. Create `packages/query/src/domains/<name>.ts` following the pattern
   above.
3. Register it in `packages/query/src/client.ts`:
   ```ts
   return {
   	posts: createPostDomain(orpc),
   	widgets: createWidgetDomain(orpc),
   };
   ```
4. Consume in components: `api.widgets.useList()`.

No other wiring is required — the client export is the only surface.
