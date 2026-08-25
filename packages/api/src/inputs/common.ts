import { z } from "zod";

/** UUID string validator. */
export const uuid = z.string().uuid();

/** ISO date string (YYYY-MM-DD). */
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const paginationInput = z.object({
	limit: z.number().int().min(1).max(100).default(50),
	offset: z.number().int().min(0).default(0),
});
