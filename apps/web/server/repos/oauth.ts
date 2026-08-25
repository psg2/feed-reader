import type { db as DB } from "@feedreader/db/client";
import {
	oauthAccessTokens,
	oauthClients,
	oauthConsents,
	oauthRefreshTokens,
} from "@feedreader/db/schema";
import { and, eq } from "drizzle-orm";

type Db = typeof DB;

/** Consents the user granted, with the client's public fields. */
export async function listConsents(db: Db, userId: string) {
	return db
		.select({
			consentId: oauthConsents.id,
			clientId: oauthConsents.clientId,
			scopes: oauthConsents.scopes,
			grantedAt: oauthConsents.createdAt,
			name: oauthClients.name,
			icon: oauthClients.icon,
			uri: oauthClients.uri,
		})
		.from(oauthConsents)
		.leftJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
		.where(eq(oauthConsents.userId, userId))
		.orderBy(oauthConsents.createdAt);
}

/** Drops the consent and every token the client holds for this user. */
export async function revokeClient(db: Db, userId: string, clientId: string) {
	await db
		.delete(oauthAccessTokens)
		.where(
			and(
				eq(oauthAccessTokens.userId, userId),
				eq(oauthAccessTokens.clientId, clientId),
			),
		);
	await db
		.delete(oauthRefreshTokens)
		.where(
			and(
				eq(oauthRefreshTokens.userId, userId),
				eq(oauthRefreshTokens.clientId, clientId),
			),
		);
	await db
		.delete(oauthConsents)
		.where(
			and(
				eq(oauthConsents.userId, userId),
				eq(oauthConsents.clientId, clientId),
			),
		);
}
