/**
 * BetterAuth tables — session, account, verification, two-factor, rate limit, API keys.
 *
 * Schema mapping: BetterAuth's internal model names → our Drizzle pgTable objects.
 * The Drizzle tables already point to the correct Postgres table names.
 *
 * - userId FKs use `uuid()` to match our `users.id` type
 * - Own PKs remain `text()` (BetterAuth manages these)
 * - Relations defined for Drizzle query API
 */
import { relations, sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const authSessions = pgTable(
	"auth_sessions",
	{
		id: text().primaryKey(),
		expiresAt: timestamp().notNull(),
		token: text().notNull().unique(),
		createdAt: timestamp().defaultNow().notNull(),
		updatedAt: timestamp()
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		ipAddress: text(),
		userAgent: text(),
		userId: uuid()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
	},
	(t) => [index("session_user_id_idx").on(t.userId)],
);

export const authAccounts = pgTable(
	"auth_accounts",
	{
		id: text().primaryKey(),
		accountId: text().notNull(),
		providerId: text().notNull(),
		userId: uuid()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		accessToken: text(),
		refreshToken: text(),
		idToken: text(),
		accessTokenExpiresAt: timestamp(),
		refreshTokenExpiresAt: timestamp(),
		scope: text(),
		password: text(),
		createdAt: timestamp().defaultNow().notNull(),
		updatedAt: timestamp()
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [index("account_user_id_idx").on(t.userId)],
);

export const verifications = pgTable(
	"auth_verifications",
	{
		id: text().primaryKey(),
		identifier: text().notNull(),
		value: text().notNull(),
		expiresAt: timestamp().notNull(),
		createdAt: timestamp().defaultNow().notNull(),
		updatedAt: timestamp()
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const twoFactors = pgTable(
	"auth_two_factor",
	{
		id: text().primaryKey(),
		secret: text(),
		backupCodes: text(),
		userId: uuid()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		verified: boolean().default(true),
		failedVerificationCount: integer().default(0),
		lockedUntil: timestamp(),
	},
	(t) => [index("two_factor_user_id_idx").on(t.userId)],
);

export const authRateLimits = pgTable("auth_rate_limit", {
	id: text().primaryKey(),
	key: text().notNull(),
	count: integer().notNull(),
	lastRequest: bigint({ mode: "number" }).notNull(),
});

/**
 * User-facing automation API keys (better-auth `apiKey` plugin).
 *
 * Keys are user-scoped — the same key authenticates the user regardless
 * of context. Keys are hashed on storage (SHA-256 by default).
 */
export const authApiKeys = pgTable(
	"apikey",
	{
		id: text().primaryKey(),
		name: text(),
		start: text(),
		prefix: text(),
		key: text().notNull().unique(),
		userId: uuid()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		refillInterval: integer(),
		refillAmount: integer(),
		lastRefillAt: timestamp({ withTimezone: true }),
		enabled: boolean().notNull().default(true),
		rateLimitEnabled: boolean().notNull().default(true),
		rateLimitTimeWindow: integer(),
		rateLimitMax: integer(),
		requestCount: integer().notNull().default(0),
		remaining: integer(),
		lastRequest: timestamp({ withTimezone: true }),
		expiresAt: timestamp({ withTimezone: true }),
		createdAt: timestamp({ withTimezone: true }).notNull(),
		updatedAt: timestamp({ withTimezone: true }).notNull(),
		permissions: text(),
		metadata: text(),
		// Newer @better-auth/api-key versions reference a key config; nullable —
		// we don't use named configs, but the adapter requires the column.
		configId: text(),
	},
	(t) => [
		index("apikey_user_id_idx").on(t.userId),
		index("apikey_key_idx").on(t.key),
	],
);

// ── OAuth Provider (for MCP / OIDC) ─────────────────────────────────────────

export const oauthClients = pgTable("oauth_clients", {
	id: uuid()
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	clientId: text().notNull().unique(),
	clientSecret: text(),
	name: text(),
	icon: text(),
	uri: text(),
	contacts: text().array(),
	tos: text(),
	policy: text(),
	softwareId: text(),
	softwareVersion: text(),
	softwareStatement: text(),
	redirectUris: text().array().notNull(),
	postLogoutRedirectUris: text().array(),
	tokenEndpointAuthMethod: text(),
	grantTypes: text().array(),
	responseTypes: text().array(),
	scopes: text().array(),
	metadata: jsonb(),
	// 1.7 replaced the `type` / `public` pair with RFC 7591 application_type;
	// public-ness is now derived from tokenEndpointAuthMethod === "none".
	applicationType: text(),
	clientDiscoveryId: text(),
	clientCredentialsScopes: text().array().default([]),
	backchannelLogoutUri: text(),
	backchannelLogoutSessionRequired: boolean(),
	jwks: text(),
	jwksUri: text(),
	dpopBoundAccessTokens: boolean().default(false),
	disabled: boolean().default(false),
	skipConsent: boolean().default(false),
	enableEndSession: boolean().default(false),
	subjectType: text(),
	// The plugin looks the column up by its model field name (`requirePKCE`).
	requirePKCE: boolean("require_pkce").default(true),
	userId: uuid().references(() => users.id, { onDelete: "cascade" }),
	referenceId: text(),
	createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const oauthAccessTokens = pgTable("oauth_access_tokens", {
	id: uuid()
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	token: text().notNull().unique(),
	clientId: text().notNull(),
	sessionId: text(),
	refreshId: text(),
	userId: uuid().references(() => users.id, { onDelete: "cascade" }),
	referenceId: text(),
	scopes: text().array().notNull(),
	// RFC 8707 resource indicators bound to the grant at authorization time.
	resources: text().array(),
	requestedUserInfoClaims: text().array(),
	authorizationCodeId: text(),
	confirmation: jsonb(),
	revoked: timestamp({ withTimezone: true }),
	createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	expiresAt: timestamp({ withTimezone: true }).notNull(),
});

export const oauthRefreshTokens = pgTable("oauth_refresh_tokens", {
	id: uuid()
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	token: text().notNull().unique(),
	clientId: text().notNull(),
	sessionId: text().notNull(),
	userId: uuid()
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	referenceId: text(),
	scopes: text().array().notNull(),
	resources: text().array(),
	requestedUserInfoClaims: text().array(),
	authorizationCodeId: text(),
	confirmation: jsonb(),
	revoked: timestamp({ withTimezone: true }),
	// Rotation reuse window: a replayed rotation within the grace period gets
	// the cached response instead of revoking the whole token family.
	rotatedAt: timestamp({ withTimezone: true }),
	rotationReplayResponse: text(),
	rotationReplayExpiresAt: timestamp({ withTimezone: true }),
	authTime: timestamp({ withTimezone: true }),
	createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	expiresAt: timestamp({ withTimezone: true }).notNull(),
});

export const oauthConsents = pgTable("oauth_consents", {
	id: uuid()
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	clientId: text().notNull(),
	userId: uuid()
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	referenceId: text(),
	scopes: text().array().notNull(),
	resources: text().array(),
	requestedUserInfoClaims: text().array(),
	createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * Protected resources (RFC 8707 audiences) the provider issues tokens for.
 * Seeded from the `resources` option in lib/auth.ts on boot.
 */
export const oauthResources = pgTable("oauth_resources", {
	id: uuid()
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	identifier: text().notNull().unique(),
	name: text().notNull(),
	accessTokenTtl: integer(),
	refreshTokenTtl: integer(),
	signingAlgorithm: text(),
	signingKeyId: text(),
	allowedScopes: text().array(),
	customClaims: jsonb(),
	dpopBoundAccessTokensRequired: boolean().default(false),
	disabled: boolean().default(false),
	policyVersion: integer().default(1),
	metadata: jsonb(),
	createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const oauthClientResources = pgTable(
	"oauth_client_resources",
	{
		id: uuid()
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		clientId: text()
			.notNull()
			.references(() => oauthClients.clientId, { onDelete: "cascade" }),
		// The plugin links by the resource `identifier`, not its row id.
		resourceId: text().notNull(),
		metadata: jsonb(),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		// Named by hand: the generated name exceeds Postgres' 63-char limit.
		foreignKey({
			name: "oauth_client_resources_resource_id_fk",
			columns: [t.resourceId],
			foreignColumns: [oauthResources.identifier],
		}).onDelete("cascade"),
		uniqueIndex("oauth_client_resources_client_resource_uidx").on(
			t.clientId,
			t.resourceId,
		),
	],
);

/** Replay protection for `private_key_jwt` client assertions (`jti`). */
export const oauthClientAssertions = pgTable("oauth_client_assertions", {
	id: text().primaryKey(),
	expiresAt: timestamp({ withTimezone: true }).notNull(),
});

// ── Relations ──────────────────────────────────────────────────────────────

export const usersAuthRelations = relations(users, ({ many }) => ({
	authSessions: many(authSessions),
	authAccounts: many(authAccounts),
	twoFactors: many(twoFactors),
}));

export const authSessionRelations = relations(authSessions, ({ one }) => ({
	user: one(users, {
		fields: [authSessions.userId],
		references: [users.id],
	}),
}));

export const authAccountRelations = relations(authAccounts, ({ one }) => ({
	user: one(users, {
		fields: [authAccounts.userId],
		references: [users.id],
	}),
}));

export const twoFactorRelations = relations(twoFactors, ({ one }) => ({
	user: one(users, {
		fields: [twoFactors.userId],
		references: [users.id],
	}),
}));
