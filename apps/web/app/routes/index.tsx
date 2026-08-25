import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Rss } from "lucide-react";
import { getAuthConfigFn, getAuthUserIdFn } from "@/app/server-fns/auth";

const REPO_URL = "https://github.com/psg2/feed-reader";

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		// Signed-in users live in the reader; the landing is for strangers.
		const userId = await getAuthUserIdFn();
		if (userId) throw redirect({ to: "/reader" });
	},
	loader: () => getAuthConfigFn(),
	component: HomePage,
});

function HomePage() {
	const { allowSignup } = Route.useLoaderData();
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-background p-8">
			<div className="flex flex-col items-center gap-4">
				<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
					<Rss className="h-7 w-7 text-primary" strokeWidth={2.25} />
				</div>
				<h1 className="text-3xl font-semibold tracking-tight">
					{"Feed Reader"}
				</h1>
				<p className="max-w-xs text-center font-serif text-lg leading-relaxed text-muted-foreground">
					{"Your blogs and newsletters, one quiet inbox."}
				</p>
				<p className="max-w-sm text-center text-sm text-muted-foreground">
					{
						"A self-hosted feed reader with newsletters by e-mail, a native macOS app and an MCP server for AI assistants. "
					}
					<a
						href={REPO_URL}
						className="underline underline-offset-4 hover:text-foreground"
					>
						{"Source on GitHub"}
					</a>
				</p>
			</div>
			<div className="flex items-center gap-3">
				<Link
					to="/sign-in"
					className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					{"Sign In"}
				</Link>
				{allowSignup && (
					<Link
						to="/sign-up"
						className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
					>
						{"Create account"}
					</Link>
				)}
			</div>
		</div>
	);
}
