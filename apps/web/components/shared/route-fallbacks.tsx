import {
	type ErrorComponentProps,
	Link,
	useRouter,
} from "@tanstack/react-router";

/**
 * Router 1.170 passes whatever was thrown, typed `unknown`. Keep showing a
 * `message` from errors and plain objects, and thrown strings as-is; other
 * values would only render as "[object Object]", so they get the fallback.
 */
function thrownMessage(error: unknown): string {
	if (typeof error === "string") return error;
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return "";
}

/**
 * Default error boundary for routes.
 * Shows a user-friendly error message with a retry button.
 */
export function DefaultErrorComponent({ error }: ErrorComponentProps) {
	const router = useRouter();
	const message = thrownMessage(error);

	return (
		<div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
			<h1 className="text-2xl font-bold">Something went wrong</h1>
			<p className="max-w-md text-muted-foreground">
				{message || "An unexpected error occurred."}
			</p>
			<div className="flex gap-2">
				<button
					type="button"
					onClick={() => router.invalidate()}
					className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>
					Try again
				</button>
				<Link
					to="/"
					className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
				>
					Go home
				</Link>
			</div>
		</div>
	);
}

/**
 * Default 404 component for routes.
 */
export function DefaultNotFoundComponent() {
	return (
		<div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
			<h1 className="text-4xl font-bold">404</h1>
			<p className="text-muted-foreground">
				The page you're looking for doesn't exist.
			</p>
			<Link
				to="/"
				className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				Go home
			</Link>
		</div>
	);
}
