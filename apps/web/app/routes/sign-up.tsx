import { createFileRoute, Link } from "@tanstack/react-router";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getSignupPageFn } from "@/app/server-fns/auth";
import { useSessionContext } from "@/components/providers/session-provider";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSeparator,
	InputOTPSlot,
} from "@/components/ui/input-otp";
import { useCooldown } from "@/hooks/use-cooldown";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient, signIn, signUp } from "@/lib/auth-client";
import { safePath, toOAuthCallbackURL } from "@/lib/oauth-callback";

export const Route = createFileRoute("/sign-up")({
	component: SignUpPage,
	// `?redirect=` is preserved through the sign-up flow so a user who lands
	// here from a protected page goes back to it after creating the account.
	// `?invite=` is the token from an invitation link (Settings › Admin).
	validateSearch: (
		search: Record<string, unknown>,
	): { redirect?: string; invite?: string } => ({
		redirect: typeof search.redirect === "string" ? search.redirect : undefined,
		invite: typeof search.invite === "string" ? search.invite : undefined,
	}),
	loaderDeps: ({ search }) => ({ invite: search.invite }),
	loader: ({ deps }) => getSignupPageFn({ data: { invite: deps.invite } }),
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SignUpPage() {
	const { redirect } = Route.useSearch();
	const { allowSignup, googleEnabled, invite } = Route.useLoaderData();
	const invited = invite.status === "valid";
	const dest = safePath(redirect);
	const { session } = useSessionContext();
	const [name, setName] = useState("");
	const [email, setEmail] = useState(invited ? invite.email : "");
	const [password, setPassword] = useState("");
	const [otp, setOtp] = useState("");
	const [step, setStep] = useState<"form" | "verify">("form");
	const [isLoading, setIsLoading] = useState(false);
	const [isGoogleLoading, setIsGoogleLoading] = useState(false);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const resendCooldown = useCooldown(45);
	// Until React takes over, a submit would be a native GET navigation that
	// puts the fields in the URL; the flag lets tests (and the button) wait.
	const [hydrated, setHydrated] = useState(false);
	useMountEffect(() => setHydrated(true));

	if (session?.user) {
		// `dest` is a runtime string (TanStack's `navigate` needs typed routes)
		// and any #hash must survive this client-side hop.
		window.location.replace(dest);
		return null;
	}

	if (invite.status === "invalid") {
		return (
			<div className="flex min-h-screen items-center justify-center p-4">
				<div className="w-full max-w-sm space-y-4 text-center">
					<h1 className="text-2xl font-bold">
						{"This invitation isn't valid"}
					</h1>
					<p className="text-sm text-muted-foreground">
						{
							"The link has expired, was already used or was revoked. Ask the person who invited you for a new one."
						}
					</p>
					{allowSignup && (
						<p className="text-sm text-muted-foreground">
							<Link
								to="/sign-up"
								search={{ redirect }}
								className="text-primary hover:underline"
							>
								{"Create an account without an invitation"}
							</Link>
						</p>
					)}
					<p className="text-sm text-muted-foreground">
						Already have an account?{" "}
						<Link
							to="/sign-in"
							search={{ redirect }}
							className="text-primary hover:underline"
						>
							Sign in
						</Link>
					</p>
				</div>
			</div>
		);
	}

	if (!allowSignup && !invited) {
		return (
			<div className="flex min-h-screen items-center justify-center p-4">
				<div className="w-full max-w-sm space-y-4 text-center">
					<h1 className="text-2xl font-bold">Registrations are closed</h1>
					<p className="text-sm text-muted-foreground">
						{
							"Registrations are closed on this instance: accounts are created by invitation. Ask its admin for an invite link, or run your own with "
						}
						<a
							href="https://github.com/psg2/feed-reader#self-host"
							className="text-primary hover:underline"
						>
							the self-hosting guide
						</a>
						.
					</p>
					<p className="text-sm text-muted-foreground">
						Already have an account?{" "}
						<Link
							to="/sign-in"
							search={{ redirect }}
							className="text-primary hover:underline"
						>
							Sign in
						</Link>
					</p>
				</div>
			</div>
		);
	}

	function validate(): boolean {
		const newErrors: Record<string, string> = {};
		if (!name.trim()) newErrors.name = "Name is required";
		if (!email.trim()) newErrors.email = "Email is required";
		else if (!EMAIL_REGEX.test(email)) newErrors.email = "Enter a valid email";
		if (!password) newErrors.password = "Password is required";
		else if (password.length < 8)
			newErrors.password = "Password must be at least 8 characters";
		setErrors(newErrors);
		return Object.keys(newErrors).length === 0;
	}

	async function handleSignUp(e: React.FormEvent): Promise<void> {
		e.preventDefault();
		if (!validate()) return;

		setIsLoading(true);
		try {
			const { error } = await signUp.email({
				name: name.trim(),
				email: email.trim(),
				password,
			});
			if (error) {
				toast.error(error.message ?? "Sign-up failed");
			} else {
				setStep("verify");
				resendCooldown.start();
				toast.success("Verification code sent to your email");
			}
		} finally {
			setIsLoading(false);
		}
	}

	async function handleResendCode(): Promise<void> {
		if (resendCooldown.secondsLeft > 0) return;
		setIsLoading(true);
		try {
			const { error } = await authClient.emailOtp.sendVerificationOtp({
				email,
				type: "email-verification",
			});
			if (error) {
				toast.error(error.message ?? "Failed to resend code");
			} else {
				resendCooldown.start();
				toast.success("New code sent");
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
			const { error } = await authClient.emailOtp.verifyEmail({ email, otp });
			if (error) {
				toast.error(error.message ?? "Invalid code");
				setOtp("");
			} else {
				toast.success("Email verified! Signing you in...");
				await signIn.email({ email, password });
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

	return (
		<div className="flex min-h-screen items-center justify-center p-4">
			<div className="w-full max-w-sm space-y-6">
				<div className="space-y-2 text-center">
					<h1 className="text-2xl font-bold">
						{step === "verify"
							? "Check your email"
							: invited
								? "You've been invited"
								: "Create an account"}
					</h1>
					<p className="text-sm text-muted-foreground">
						{step === "verify" ? (
							<>
								We sent a 6-digit code to{" "}
								<span className="font-medium text-foreground">{email}</span>
							</>
						) : invited ? (
							"Create your account to accept the invitation"
						) : (
							"Get started with your free account"
						)}
					</p>
				</div>

				{step === "form" ? (
					<>
						{googleEnabled && (
							<>
								<button
									type="button"
									onClick={handleGoogleSignIn}
									disabled={isGoogleLoading}
									className="flex w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
								>
									{isGoogleLoading ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<GoogleIcon />
									)}
									Continue with Google
								</button>

								<div className="relative">
									<div className="absolute inset-0 flex items-center">
										<span className="w-full border-t" />
									</div>
									<div className="relative flex justify-center text-xs uppercase">
										<span className="bg-background px-2 text-muted-foreground">
											Or continue with email
										</span>
									</div>
								</div>
							</>
						)}

						<form
							onSubmit={handleSignUp}
							className="space-y-4"
							data-hydrated={hydrated || undefined}
						>
							<div className="space-y-2">
								<label htmlFor="name" className="text-sm font-medium">
									Name
								</label>
								<input
									id="name"
									type="text"
									value={name}
									onChange={(e) => {
										setName(e.target.value);
										setErrors((p) => {
											const { name: _, ...rest } = p;
											return rest;
										});
									}}
									className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
									placeholder="Your name"
									autoComplete="name"
								/>
								{errors.name && (
									<p className="text-xs text-destructive">{errors.name}</p>
								)}
							</div>
							<div className="space-y-2">
								<label htmlFor="email" className="text-sm font-medium">
									Email
								</label>
								<input
									id="email"
									type="email"
									value={email}
									readOnly={invited}
									onChange={(e) => {
										setEmail(e.target.value);
										setErrors((p) => {
											const { email: _, ...rest } = p;
											return rest;
										});
									}}
									className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm read-only:text-muted-foreground"
									placeholder="you@example.com"
									autoComplete="email"
								/>
								{invited && (
									<p className="text-xs text-muted-foreground">
										{"The invitation is for this address."}
									</p>
								)}
								{errors.email && (
									<p className="text-xs text-destructive">{errors.email}</p>
								)}
							</div>
							<div className="space-y-2">
								<label htmlFor="password" className="text-sm font-medium">
									Password
								</label>
								<input
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
									className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
									placeholder="At least 8 characters"
									autoComplete="new-password"
								/>
								{errors.password && (
									<p className="text-xs text-destructive">{errors.password}</p>
								)}
							</div>
							<button
								type="submit"
								disabled={isLoading}
								className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
							>
								{isLoading ? (
									<Loader2 className="mx-auto h-4 w-4 animate-spin" />
								) : (
									"Create Account"
								)}
							</button>
						</form>
					</>
				) : (
					<form onSubmit={handleVerifyOtp} className="space-y-5">
						<div className="flex justify-center">
							<InputOTP
								maxLength={6}
								pattern={REGEXP_ONLY_DIGITS}
								value={otp}
								onChange={setOtp}
								onComplete={() =>
									document.getElementById("verify-signup-btn")?.click()
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
						<button
							id="verify-signup-btn"
							type="submit"
							disabled={isLoading || otp.length !== 6}
							className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{isLoading ? (
								<Loader2 className="mx-auto h-4 w-4 animate-spin" />
							) : (
								"Verify and sign in"
							)}
						</button>
						<div className="flex items-center justify-between gap-2 text-sm">
							<button
								type="button"
								onClick={() => {
									setStep("form");
									setOtp("");
								}}
								className="text-muted-foreground hover:text-foreground"
							>
								Back
							</button>
							<button
								type="button"
								onClick={handleResendCode}
								disabled={isLoading || resendCooldown.secondsLeft > 0}
								className="text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
							>
								{resendCooldown.secondsLeft > 0
									? `Resend (${resendCooldown.secondsLeft}s)`
									: "Resend code"}
							</button>
						</div>
					</form>
				)}

				<p className="text-center text-sm text-muted-foreground">
					Already have an account?{" "}
					<Link
						to="/sign-in"
						search={{ redirect }}
						className="text-primary hover:underline"
					>
						Sign in
					</Link>
				</p>
			</div>
		</div>
	);
}

function GoogleIcon() {
	return (
		<svg className="h-4 w-4" viewBox="0 0 24 24">
			<title>Google</title>
			<path
				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
				fill="#4285F4"
			/>
			<path
				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
				fill="#34A853"
			/>
			<path
				d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
				fill="#FBBC05"
			/>
			<path
				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
				fill="#EA4335"
			/>
		</svg>
	);
}
