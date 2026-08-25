/**
 * Shared mock data for frontend component tests.
 *
 * These objects mirror API output shapes without needing a database.
 * Use them in component tests to avoid duplicating test data.
 */

// ── Users ────────────────────────────────────────────────────────────────

export const userAlice = {
	id: "user-alice-0001-0001-0001-000000000001",
	name: "Alice Johnson",
	email: "alice@example.com",
	emailVerified: true,
	imageUrl: null,
	createdAt: new Date("2026-01-15T10:00:00Z"),
	updatedAt: new Date("2026-01-15T10:00:00Z"),
};

export const userBob = {
	id: "user-bob-00002-0002-0002-000000000002",
	name: "Bob Smith",
	email: "bob@example.com",
	emailVerified: true,
	imageUrl: null,
	createdAt: new Date("2026-02-01T14:30:00Z"),
	updatedAt: new Date("2026-02-01T14:30:00Z"),
};

export const userAdmin = {
	id: "user-admin-0003-0003-0003-000000000003",
	name: "Admin User",
	email: "admin@example.com",
	emailVerified: true,
	imageUrl: null,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
};
