import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
	createPaneStore,
	DEFAULT_PANES,
	PANES,
	PANES_STORAGE_KEY,
	usePaneSizes,
} from "./use-pane-sizes";

function memoryStorage(initial: Record<string, string> = {}): Storage {
	const map = new Map(Object.entries(initial));
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k),
		clear: () => map.clear(),
		key: (i: number) => [...map.keys()][i] ?? null,
		get length() {
			return map.size;
		},
	};
}

describe("pane store", () => {
	let storage: Storage;
	let store: ReturnType<typeof createPaneStore>;

	beforeEach(() => {
		storage = memoryStorage();
		store = createPaneStore(() => storage);
	});

	it("starts from the defaults when nothing is stored", () => {
		expect(store.get()).toEqual(DEFAULT_PANES);
	});

	it("clamps the sidebar and list to their bounds", () => {
		store.setSidebar(10_000);
		expect(store.get().sidebar).toBe(PANES.sidebar.max);
		store.setSidebar(0);
		expect(store.get().sidebar).toBe(PANES.sidebar.min);
		store.setList(1);
		expect(store.get().list).toBe(PANES.list.min);
		store.setList(9_999);
		expect(store.get().list).toBe(PANES.list.max);
		store.setList(300.4);
		expect(store.get().list).toBe(300);
	});

	it("snaps the sidebar to the rail when dragged below the snap point", () => {
		store.dragSidebar(300);
		expect(store.get()).toMatchObject({ sidebar: 300, collapsed: false });
		store.dragSidebar(PANES.sidebar.snap - 1);
		expect(store.get()).toMatchObject({ sidebar: 300, collapsed: true });
		// A drag sweeps through the minimum before snapping; the start width
		// wins so expanding later restores it.
		store.dragSidebar(200);
		store.dragSidebar(PANES.sidebar.min);
		store.dragSidebar(10, 300);
		expect(store.get()).toMatchObject({ sidebar: 300, collapsed: true });
		// Dragging back out re-expands and clamps to the minimum.
		store.dragSidebar(PANES.sidebar.snap);
		expect(store.get()).toMatchObject({
			sidebar: PANES.sidebar.min,
			collapsed: false,
		});
	});

	it("toggles and resets", () => {
		store.toggleCollapsed();
		expect(store.get().collapsed).toBe(true);
		store.setSidebar(400);
		store.resetSidebar();
		expect(store.get()).toMatchObject({
			sidebar: PANES.sidebar.default,
			collapsed: false,
		});
		store.setList(600);
		store.resetList();
		expect(store.get().list).toBe(PANES.list.default);
	});

	it("persists to storage as JSON and reads it back", () => {
		store.setSidebar(320);
		store.setList(400);
		store.toggleCollapsed();
		expect(JSON.parse(storage.getItem(PANES_STORAGE_KEY) ?? "")).toEqual({
			sidebar: 320,
			list: 400,
			collapsed: true,
		});
		const fresh = createPaneStore(() => storage);
		expect(fresh.get()).toEqual({ sidebar: 320, list: 400, collapsed: true });
	});

	it("sanitises stored values", () => {
		storage.setItem(
			PANES_STORAGE_KEY,
			JSON.stringify({ sidebar: 9_999, list: "x", collapsed: "yes" }),
		);
		expect(createPaneStore(() => storage).get()).toEqual({
			sidebar: PANES.sidebar.max,
			list: PANES.list.default,
			collapsed: false,
		});
		storage.setItem(PANES_STORAGE_KEY, "{not json");
		expect(createPaneStore(() => storage).get()).toEqual(DEFAULT_PANES);
	});

	it("survives storage that throws", () => {
		const broken = createPaneStore(() => {
			throw new Error("blocked");
		});
		expect(broken.get()).toEqual(DEFAULT_PANES);
		broken.setList(500);
		expect(broken.get().list).toBe(500);
	});

	it("notifies subscribers only on actual change", () => {
		let n = 0;
		store.subscribe(() => n++);
		store.setList(PANES.list.default);
		expect(n).toBe(0);
		store.setList(500);
		expect(n).toBe(1);
	});
});

describe("usePaneSizes", () => {
	it("re-renders when the store changes", () => {
		const store = createPaneStore(() => memoryStorage());
		const { result } = renderHook(() => usePaneSizes(store));
		expect(result.current.list).toBe(PANES.list.default);
		act(() => result.current.store.setList(420));
		expect(result.current.list).toBe(420);
		act(() => result.current.store.dragSidebar(50));
		expect(result.current.collapsed).toBe(true);
	});
});
