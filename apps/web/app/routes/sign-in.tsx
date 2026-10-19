import { createFileRoute, Link } from "@tanstack/react-router";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Loader2, Mail } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getAuthConfigFn } from "@/app/server-fns/auth";
import { useSessionContext } from "@/components/providers/session-provider";
import { DemoCredentialsHint } from "@/components/shared/demo-credentials-hint";
import { GoogleIcon } from "@/components/shared/google-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSeparator,
	InputOTPSlot,
} from "@/components/ui/input-otp";
import { useCooldown } from "@/hooks/use-cooldown";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient, signIn } from "@/lib/auth-client";
import {
	oauthResumePath,
	safePath,
	toOAuthCallbackURL,
} from "@/lib/oauth-callback";

export const Route = createFileRoute("/sign-in")({
	component: SignInPage,
	loader: () => getAuthConfigFn(),
	validateSearch: (
		search: Record<string, unknown>,
	): { error?: string; redirect?: string } => ({
		error: typeof search.error === "string" ? search.error : undefined,
		redirect: typeof search.redirect === "string" ? search.redirect : undefined,
	}),
});

/**
 * Three modes:
 *  - `password`     — default; email + password (+ Google when configured)
 *  - `passwordless` — email-only, sends the code on submit
 *  - `otp`          — six-slot code input + resend-with-cooldown
 */
type SignInMode = "password" | "passwordless" | "otp";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SignInPage() {
	const { error: authError, redirect } = Route.useSearch();
	const authConfig = Route.useLoaderData();
	// Mid-OAuth login (MCP clients): resume the authorize flow after sign-in.
	const resume =
		typeof window === "undefined"
			? null
			: oauthResumePath(window.location.search);
	const dest = resume ?? safePath(redirect);
	const { session, isPending } = useSessionContext();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [otp, setOtp] = useState("");
	const [mode, setMode] = useState<SignInMode>("password");
	const [isLoading, setIsLoading] = useState(false);
	const [isGoogleLoading, setIsGoogleLoading] = useState(false);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const resendCooldown = useCooldown(45);

	useMountEffect(() => {
		if (authError) {
			toast.error("Authentication failed. Please try again.");
			window.history.replaceState({}, "", "/sign-in");
		}
	});

	if (session?.user) {
		// `dest` is a runtime string (TanStack's `navigate` needs typed routes)
		// and any #hash must survive this client-side hop.
		window.location.replace(dest);
		return null;
	}

	function validateEmail(): boolean {
		if (!email.trim()) {
			setErrors((p) => ({ ...p, email: "Email is required" }));
			return false;
		}
		if (!EMAIL_REGEX.test(email)) {
			setErrors((p) => ({ ...p, email: "Enter a valid email" }));
			return false;
		}
		setErrors((p) => {
			const { email: _, ...rest } = p;
			return rest;
		});
		return true;
	}

	async function handlePasswordSignIn(e: React.FormEvent): Promise<void> {
		e.preventDefault();
		if (!validateEmail()) return;
		if (!password) {
			setErrors((p) => ({ ...p, password: "Password is required" }));
			return;
		}

		setIsLoading(true);
		try {
			const { error } = await signIn.email({ email, password });
			if (error) {
				toast.error(error.message ?? "Sign-in failed");
			}
		} finally {
			setIsLoading(false);
		}
	}

	async function handleSendOtp(e?: React.FormEvent): Promise<void> {
		e?.preventDefault();
		if (!validateEmail()) return;

		setIsLoading(true);
		try {
			const { error } = await authClient.emailOtp.sendVerificationOtp({
				email,
				type: "sign-in",
			});
			if (error) {
				toast.error(error.message ?? "Failed to send code");
			} else {
				toast.success("Verification code sent");
				resendCooldown.start();
				setMode("otp");
			}
		} finally {
			setIsLoading(false);
		}
	}

	async function handleVerifyOtp(e: React.FormEvent): Promise<void> {
		e.preventDefault();
		if (otp.length !== 6) return;

		setIsLoading(true);
		try {
			const { error } = await signIn.emailOtp({ email, otp });
			if (error) {
				toast.error(error.message ?? "Invalid code");
				setOtp("");
			}
		} finally {
			setIsLoading(false);
		}
	}

	async function handleGoogleSignIn(): Promise<void> {
		setIsGoogleLoading(true);
		try {
			// OAuth callbacks can't carry a #fragment (BetterAuth 403s on it), so
			// the anchor is dropped — acceptable loss on the OAuth return trip.
			await signIn.social({
				provider: "google",
				callbackURL: toOAuthCallbackURL(dest),
			});
		} catch {
			toast.error("Google sign-in failed");
			setIsGoogleLoading(false);
		}
	}

	const demoHint = (
		<DemoCredentialsHint
			onFill={(e, p) => {
				setEmail(e);
				setPassword(p);
				setMode("password");
			}}
		/>
	);

	if (isPending) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				{demoHint}
			</div>
		);
	}

	return (
		<div className="flex min-h-screen items-center justify-center p-4">
			{demoHint}
			<div className="w-full max-w-sm space-y-6">
				<div className="space-y-2 text-center">
					<h1 className="text-2xl font-bold">
						{mode === "otp" ? "Check your email" : "Welcome back"}
					</h1>
					<p className="text-sm text-muted-foreground">
						{mode === "otp" ? (
							<>
								We sent a 6-digit code to{" "}
								<span className="font-medium text-foreground">{email}</span>
							</>
						) : mode === "passwordless" ? (
							"Get a 6-digit code by email"
						) : (
							"Sign in to your account"
						)}
					</p>
				</div>

				{mode === "password" && (
					<>
						{authConfig.google && (
							<>
								<Button
									type="button"
									onClick={handleGoogleSignIn}
									disabled={isGoogleLoading}
									variant="outline"
									size="lg"
									className="w-full"
								>
									{isGoogleLoading ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<GoogleIcon />
									)}
									Continue with Google
								</Button>

								<Divider />
							</>
						)}

						<form onSubmit={handlePasswordSignIn} className="space-y-4">
							<EmailField
								email={email}
								setEmail={setEmail}
								error={errors.email}
								clearError={() =>
									setErrors((p) => {
										const { email: _, ...rest } = p;
										return rest;
									})
								}
							/>
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<label htmlFor="password" className="text-sm font-medium">
										Password
									</label>
									{authConfig.passwordReset && (
										<Link
											to="/forgot-password"
											className="text-xs text-muted-foreground hover:underline"
										>
											Forgot password?
										</Link>
									)}
								</div>
								<Input
									id="password"
									type="password"
									value={password}
									onChange={(e) => {
										setPassword(e.target.value);
										setErrors((p) => {
											const { password: _, ...rest } = p;
											return rest;
										});
									}}
									placeholder="••••••••"
									autoComplete="current-password"
								/>
								{errors.password && (
									<p className="text-xs text-destructive">{errors.password}</p>
								)}
							</div>
							<Button
								type="submit"
								disabled={isLoading}
								size="lg"
								className="w-full"
							>
								{isLoading ? (
									<Loader2 className="mx-auto h-4 w-4 animate-spin" />
								) : (
									"Sign In"
								)}
							</Button>
						</form>

						{authConfig.emailOtp && (
							<Button
								type="button"
								onClick={() => {
									setMode("passwordless");
									setPassword("");
								}}
								variant="outline-muted"
								size="lg"
								className="w-full"
							>
								<Mail className="h-4 w-4" />
								Sign in with an email code
							</Button>
						)}
					</>
				)}

				{mode === "passwordless" && (
					<form onSubmit={handleSendOtp} className="space-y-4">
						<EmailField
							email={email}
							setEmail={setEmail}
							error={errors.email}
							clearError={() =>
								setErrors((p) => {
									const { email: _, ...rest } = p;
									return rest;
								})
							}
							autoFocus
						/>
						<Button
							type="submit"
							disabled={isLoading}
							size="lg"
							className="w-full"
						>
							{isLoading ? (
								<Loader2 className="mx-auto h-4 w-4 animate-spin" />
							) : (
								"Send code"
							)}
						</Button>
						<Button
							type="button"
							onClick={() => setMode("password")}
							variant="text"
							size="inline-sm"
							className="w-full"
						>
							Back to password
						</Button>
					</form>
				)}

				{mode === "otp" && (
					<form onSubmit={handleVerifyOtp} className="space-y-5">
						<div className="flex justify-center">
							<InputOTP
								maxLength={6}
								pattern={REGEXP_ONLY_DIGITS}
								value={otp}
								onChange={setOtp}
								onComplete={() =>
									document.getElementById("verify-signin-btn")?.click()
								}
								autoFocus
							>
								<InputOTPGroup>
									<InputOTPSlot index={0} />
									<InputOTPSlot index={1} />
									<InputOTPSlot index={2} />
								</InputOTPGroup>
								<InputOTPSeparator />
								<InputOTPGroup>
									<InputOTPSlot index={3} />
									<InputOTPSlot index={4} />
									<InputOTPSlot index={5} />
								</InputOTPGroup>
							</InputOTP>
						</div>
						<Button
							id="verify-signin-btn"
							type="submit"
							disabled={isLoading || otp.length !== 6}
							size="lg"
							className="w-full"
						>
							{isLoading ? (
								<Loader2 className="mx-auto h-4 w-4 animate-spin" />
							) : (
								"Verify"
							)}
						</Button>
						<div className="flex items-center justify-between gap-2 text-sm">
							<Button
								type="button"
								onClick={() => {
									setOtp("");
									setMode("password");
								}}
								variant="text"
								size="inline"
							>
								Change email
							</Button>
							<Button
								type="button"
								onClick={() => handleSendOtp()}
								disabled={isLoading || resendCooldown.secondsLeft > 0}
								variant="text"
								size="inline"
							>
								{resendCooldown.secondsLeft > 0
									? `Resend (${resendCooldown.secondsLeft}s)`
									: "Resend code"}
							</Button>
						</div>
					</form>
				)}

				{authConfig.allowSignup &&
					(authConfig.passwordSignUp || authConfig.google) && (
						<p className="text-center text-sm text-muted-foreground">
							Don't have an account?{" "}
							<Link
								to="/sign-up"
								search={{ redirect }}
								className="text-primary hover:underline"
							>
								Sign up
							</Link>
						</p>
					)}
			</div>
		</div>
	);
}

/** Email field used by both the password and passwordless modes. */
function EmailField({
	email,
	setEmail,
	error,
	clearError,
	autoFocus,
}: {
	email: string;
	setEmail: (s: string) => void;
	error?: string;
	clearError: () => void;
	autoFocus?: boolean;
}) {
	return (
		<div className="space-y-2">
			<label htmlFor="email" className="text-sm font-medium">
				Email
			</label>
			<Input
				id="email"
				type="email"
				value={email}
				onChange={(e) => {
					setEmail(e.target.value);
					clearError();
				}}
				placeholder="you@example.com"
				autoComplete="email"
				autoFocus={autoFocus}
			/>
			{error && <p className="text-xs text-destructive">{error}</p>}
		</div>
	);
}

function Divider() {
	return (
		<div className="relative">
			<div className="absolute inset-0 flex items-center">
				<span className="w-full border-t" />
			</div>
			<div className="relative flex justify-center text-xs uppercase">
				<span className="bg-background px-2 text-muted-foreground">
					Or continue with
				</span>
			</div>
		</div>
	);
}
