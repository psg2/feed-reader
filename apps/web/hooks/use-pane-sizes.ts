import { useSyncExternalStore } from "react";

/** Desktop reader pane widths, in px. Defaults match the former fixed
 * layout (`w-60` sidebar, `w-88` list). */
export const PANES = {
	sidebar: { min: 180, max: 420, default: 240, rail: 56, snap: 120 },
	list: { min: 280, max: 640, default: 352 },
	step: 16,
} as const;

export const PANES_STORAGE_KEY = "feedreader.panes";

export type PaneSizes = {
	/** Expanded sidebar width; kept while collapsed so expanding restores it. */
	sidebar: number;
	list: number;
	collapsed: boolean;
};

export const DEFAULT_PANES: PaneSizes = {
	sidebar: PANES.sidebar.default,
	list: PANES.list.default,
	collapsed: false,
};

const clamp = (n: number, min: number, max: number) =>
	Math.min(max, Math.max(min, Math.round(n)));

export const clampSidebar = (px: number) =>
	clamp(px, PANES.sidebar.min, PANES.sidebar.max);
export const clampList = (px: number) =>
	clamp(px, PANES.list.min, PANES.list.max);

function parse(raw: string | null): PaneSizes {
	if (!raw) return DEFAULT_PANES;
	try {
		const v = JSON.parse(raw) as Partial<PaneSizes> | null;
		if (!v || typeof v !== "object") return DEFAULT_PANES;
		return {
			sidebar:
				typeof v.sidebar === "number" && Number.isFinite(v.sidebar)
					? clampSidebar(v.sidebar)
					: DEFAULT_PANES.sidebar,
			list:
				typeof v.list === "number" && Number.isFinite(v.list)
					? clampList(v.list)
					: DEFAULT_PANES.list,
			collapsed: v.collapsed === true,
		};
	} catch {
		return DEFAULT_PANES;
	}
}

export type PaneStore = ReturnType<typeof createPaneStore>;

/**
 * Tiny external store so every consumer (layout, list-header toggle, palette,
 * shortcut) shares one state without prop drilling. `storage` is resolved
 * lazily and guarded so SSR and blocked storage both fall back to defaults.
 */
export function createPaneStore(storage: () => Storage | undefined) {
	let state: PaneSizes | undefined;
	const listeners = new Set<() => void>();

	const read = (): PaneSizes => {
		if (state) return state;
		try {
			state = parse(storage()?.getItem(PANES_STORAGE_KEY) ?? null);
		} catch {
			state = DEFAULT_PANES;
		}
		return state;
	};

	const set = (patch: Partial<PaneSizes>) => {
		const prev = read();
		const next = { ...prev, ...patch };
		if (
			next.sidebar === prev.sidebar &&
			next.list === prev.list &&
			next.collapsed === prev.collapsed
		)
			return;
		state = next;
		try {
			storage()?.setItem(PANES_STORAGE_KEY, JSON.stringify(next));
		} catch {
			// Private mode or quota: keep the in-memory value.
		}
		for (const l of listeners) l();
	};

	return {
		get: read,
		getServer: () => DEFAULT_PANES,
		subscribe: (l: () => void) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		/** Drag target for the sidebar; below the snap point it collapses to
		 * the icon rail, above it expands again. `restore` is the width the
		 * drag started from, kept so expanding later returns to it rather
		 * than to the minimum the pointer swept through. */
		dragSidebar: (px: number, restore?: number) => {
			if (px < PANES.sidebar.snap)
				set({
					collapsed: true,
					...(restore !== undefined ? { sidebar: clampSidebar(restore) } : {}),
				});
			else set({ collapsed: false, sidebar: clampSidebar(px) });
		},
		setSidebar: (px: number) => set({ sidebar: clampSidebar(px) }),
		setList: (px: number) => set({ list: clampList(px) }),
		toggleCollapsed: () => set({ collapsed: !read().collapsed }),
		setCollapsed: (collapsed: boolean) => set({ collapsed }),
		resetSidebar: () =>
			set({ sidebar: PANES.sidebar.default, collapsed: false }),
		resetList: () => set({ list: PANES.list.default }),
		/** Test hook: forget the cached state so the next read hits storage. */
		reset: () => {
			state = undefined;
		},
	};
}

export const paneStore = createPaneStore(() =>
	typeof window === "undefined" ? undefined : window.localStorage,
);

export function usePaneSizes(store: PaneStore = paneStore) {
	const sizes = useSyncExternalStore(
		store.subscribe,
		store.get,
		store.getServer,
	);
	return { ...sizes, store };
}
