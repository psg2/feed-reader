let last: { label: string; run: () => void } | null = null;

/** Single-slot undo: the most recent mark-all / read / star can be reverted with `z`. */
export const undo = {
	set(label: string, run: () => void) {
		last = { label, run };
	},
	take() {
		const it = last;
		last = null;
		return it;
	},
};
