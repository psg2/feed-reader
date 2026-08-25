import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useSessionContext } from "@/components/providers/session-provider";

/**
 * OAuth consent page — shown when an MCP client (or other OAuth app)
 * requests access to the user's account.
 *
 * BetterAuth redirects here with the signed authorization query
 * (?client_id=...&scope=...&ba_*=...&sig=...). After the user accepts or
 * denies, we POST the full query back as `oauth_query` to
 * /api/auth/oauth2/consent, which verifies the signature and answers with the
 * redirect URL carrying the authorization code.
 */

const SCOPE_LABELS: Record<string, { label: string; description: string }> = {
	openid: {
		label: "Identity",
		description: "Confirm your identity",
	},
	profile: {
		label: "Profile",
		description: "Your name and profile picture",
	},
	email: {
		label: "Email",
		description: "Your email address",
	},
	offline_access: {
		label: "Continuous access",
		description: "Maintain access when you're not actively using the app",
	},
};

/** Public client fields from the oauth-provider plugin (snake_case per RFC 7591). */
function useClientName(clientId: string) {
	return useQuery({
		queryKey: ["oauth", "public-client", clientId],
		enabled: clientId !== "",
		staleTime: Number.POSITIVE_INFINITY,
		queryFn: async () => {
			const res = await fetch(
				`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`,
				{ credentials: "include" },
			);
			if (!res.ok) return null;
			const data = (await res.json()) as { client_name?: string | null };
			return data.client_name ?? null;
		},
	});
}

export const Route = createFileRoute("/oauth/consent")({
	component: ConsentPage,
	validateSearch: (search: Record<string, unknown>) => ({
		client_id: (search.client_id as string) ?? "",
		scope: (search.scope as string) ?? "openid",
	}),
});

function ConsentPage() {
	const { client_id, scope } = Route.useSearch();
	const { session } = useSessionContext();
	const navigate = useNavigate();
	const [loading, setLoading] = useState<"accept" | "deny" | null>(null);
	const { data: clientName } = useClientName(client_id);

	const scopes = scope.split(" ").filter(Boolean);

	async function handleConsent(accept: boolean) {
		setLoading(accept ? "accept" : "deny");
		try {
			const res = await fetch("/api/auth/oauth2/consent", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					accept,
					// The whole signed query BetterAuth redirected here with —
					// it carries the original authorize params plus a signature.
					oauth_query: window.location.search.slice(1),
				}),
			});

			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(
					(data as { message?: string })?.message ??
						"Failed to process consent",
				);
			}

			const data = (await res.json()) as {
				url?: string;
				redirect_uri?: string;
			};
			const target = data.url ?? data.redirect_uri;

			if (target) {
				window.location.href = target;
			} else {
				navigate({ to: "/reader" });
			}
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Error processing. Try again.",
			);
			setLoading(null);
		}
	}

	if (!client_id) {
		return (
			<div className="flex min-h-screen items-center justify-center p-4">
				<div className="text-center">
					<p className="text-muted-foreground">
						Invalid authorization parameters.
					</p>
					<button
						type="button"
						className="mt-4 rounded-md border border-input px-4 py-2 text-sm hover:bg-accent"
						onClick={() => navigate({ to: "/reader" })}
					>
						Go back
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
			<div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-6 shadow-lg">
				{/* Header */}
				<div className="flex flex-col items-center gap-3 text-center">
					<div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
						<ShieldCheck className="h-7 w-7 text-primary" aria-hidden="true" />
					</div>
					<div>
						<h1 className="text-xl font-bold">Authorize access</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							{clientName ? (
								<>
									<span className="font-medium text-foreground">
										{clientName}
									</span>
									{" wants to access your account"}
								</>
							) : (
								"An application wants to access your account"
							)}
						</p>
					</div>
				</div>

				{/* User info */}
				{session?.user && (
					<div className="rounded-lg bg-muted/50 px-4 py-3 text-center text-sm">
						Signed in as{" "}
						<span className="font-medium">{session.user.name}</span>
						<span className="text-muted-foreground">
							{" "}
							({session.user.email})
						</span>
					</div>
				)}

				{/* Requested permissions */}
				<div className="space-y-3">
					<div className="flex items-center gap-2 text-sm font-medium">
						<ShieldCheck
							className="h-4 w-4 text-muted-foreground"
							aria-hidden="true"
						/>
						<span>Requested permissions</span>
					</div>
					<ul className="space-y-2">
						{scopes.map((s) => {
							const info = SCOPE_LABELS[s];
							if (!info) return null;
							return (
								<li
									key={s}
									className="flex items-start gap-3 rounded-lg border px-4 py-3"
								>
									<div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
									<div>
										<p className="text-sm font-medium">{info.label}</p>
										<p className="text-xs text-muted-foreground">
											{info.description}
										</p>
									</div>
								</li>
							);
						})}
					</ul>
				</div>

				{/* Actions */}
				<div className="flex gap-3">
					<button
						type="button"
						className="flex flex-1 items-center justify-center rounded-md border border-input px-4 py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
						disabled={loading !== null}
						onClick={() => handleConsent(false)}
					>
						{loading === "deny" && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Deny
					</button>
					<button
						type="button"
						className="flex flex-1 items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						disabled={loading !== null}
						onClick={() => handleConsent(true)}
					>
						{loading === "accept" && (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						)}
						Authorize
					</button>
				</div>

				<p className="text-center text-xs text-muted-foreground">
					You can revoke this access at any time in your account settings.
				</p>
			</div>
		</div>
	);
}
