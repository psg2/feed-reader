import { Sparkles } from "lucide-react";
import { type RefObject, useEffectEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";

/**
 * Floating button listing seeded demo accounts. Renders nothing in
 * production deploys — visible only in local dev (`import.meta.env.DEV`)
 * and Vercel preview deploys (`VITE_PUBLIC_VERCEL_ENV === "preview"`).
 *
 * Why: preview deploys often reseed every build, and local dev needs
 * the same demo accounts. Surface them inline so reviewers don't have
 * to dig through the seed script.
 *
 * Edit ACCOUNTS to add or rename. Defaults match packages/db/src/seed.ts.
 */

const DEMO_PASSWORD = "12345678";

type DemoAccount = {
	role: string;
	email: string;
	description: string;
};

const ACCOUNTS: readonly DemoAccount[] = [
	{
		role: "User",
		email: "user@example.com",
		description: "Regular user",
	},
];

function shouldRender(): boolean {
	if (import.meta.env.DEV) return true;
	if (import.meta.env.VITE_PUBLIC_VERCEL_ENV === "preview") return true;
	return false;
}

export function DemoCredentialsHint({
	onFill,
}: {
	onFill?: (email: string, password: string) => void;
}): React.ReactElement | null {
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	if (!shouldRender()) return null;

	return (
		// `items-end` keeps the button pinned to the right edge of the container
		// whether or not the popover (w-80) is rendered — without it, opening the
		// popover widens the container and the button visually shifts left.
		// `bottom-20` clears the TanStack devtools badge in the bottom-right corner.
		<div
			ref={containerRef}
			className="fixed right-4 bottom-20 z-50 flex flex-col items-end"
		>
			{open && (
				<DismissOnOutsideInteraction
					containerRef={containerRef}
					onDismiss={() => setOpen(false)}
				/>
			)}
			{open && (
				<div className="mb-2 w-80 rounded-md border bg-background p-3 text-left shadow-lg">
					<div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-primary">
						<Sparkles className="h-3.5 w-3.5" />
						<span>Demo accounts (dev / preview)</span>
					</div>
					<ul className="space-y-2">
						{ACCOUNTS.map((account) => (
							<li
								key={account.email}
								className="flex items-center justify-between gap-2"
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-baseline gap-1.5">
										<span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
											{account.role}
										</span>
										<span className="truncate font-mono text-xs">
											{account.email}
										</span>
									</div>
									<p className="text-2xs text-muted-foreground">
										{account.description}
									</p>
								</div>
								{onFill ? (
									<Button
										type="button"
										onClick={() => {
											onFill(account.email, DEMO_PASSWORD);
											setOpen(false);
										}}
										variant="outline-primary"
										size="chip"
										className="shrink-0"
									>
										Fill
									</Button>
								) : null}
							</li>
						))}
					</ul>
					<p className="mt-2 text-2xs text-muted-foreground">
						Shared password: <code className="font-mono">{DEMO_PASSWORD}</code>
					</p>
				</div>
			)}
			<Button
				type="button"
				aria-label="Demo accounts"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				variant="floating-primary"
				size="compact"
			>
				<Sparkles className="h-3.5 w-3.5" />
				Demo accounts
			</Button>
		</div>
	);
}

/**
 * Renders nothing; attaches document listeners that dismiss the popover on
 * outside click or Escape. Lifecycle is bound to mount/unmount, which the
 * parent controls via conditional rendering — so dependencies are stable.
 */
function DismissOnOutsideInteraction({
	containerRef,
	onDismiss,
}: {
	containerRef: RefObject<HTMLDivElement | null>;
	onDismiss: () => void;
}): null {
	const dismiss = useEffectEvent(onDismiss);

	useMountEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (
				containerRef.current &&
				!containerRef.current.contains(e.target as Node)
			) {
				dismiss();
			}
		}
		function handleEscape(e: KeyboardEvent) {
			if (e.key === "Escape") dismiss();
		}
		document.addEventListener("mousedown", handleClickOutside);
		document.addEventListener("keydown", handleEscape);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			document.removeEventListener("keydown", handleEscape);
		};
	});

	return null;
}
