import { createApiClient } from "@feedreader/query";
import { orpc } from "./orpc";

/**
 * Centralized API client — domain hooks with built-in cache management.
 *
 * Use this instead of raw `orpc.*` in components:
 *
 * ```tsx
 * import { api } from "@/lib/api";
 *
 * const { data } = api.reader.useFeeds();
 * const subscribe = api.reader.useSubscribe({ onSuccess: () => toast("Done") });
 * ```
 */
export const api = createApiClient(orpc);
