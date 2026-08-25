import * as Sentry from "@sentry/tanstackstart-react";

export function setSentryUser(user: {
	id: string;
	email?: string | null;
	username?: string | null;
}): void {
	Sentry.setUser({
		id: user.id,
		email: user.email ?? undefined,
		username: user.username ?? undefined,
	});
}

export function clearSentryUser(): void {
	Sentry.setUser(null);
}

export function captureException(
	error: unknown,
	context?: {
		tags?: Record<string, string>;
		extra?: Record<string, unknown>;
		level?: Sentry.SeverityLevel;
	},
): string {
	return Sentry.captureException(error, {
		tags: context?.tags,
		extra: context?.extra,
		level: context?.level,
	});
}
