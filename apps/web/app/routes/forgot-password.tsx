import { createFileRoute, Link } from "@tanstack/react-router";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSeparator,
	InputOTPSlot,
} from "@/components/ui/input-otp";
import { useCooldown } from "@/hooks/use-cooldown";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/forgot-password")({
	component: ForgotPasswordPage,
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ForgotPasswordPage() {
	const [email, setEmail] = useState("");
	const [otp, setOtp] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [step, setStep] = useState<"email" | "verify" | "done">("email");
	const [isLoading, setIsLoading] = useState(false);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const resendCooldown = useCooldown(45);

	function validateEmail(): boolean {
		if (!email.trim()) {
			setErrors({ email: "Email is required" });
			return false;
		}
		if (!EMAIL_REGEX.test(email)) {
			setErrors({ email: "Enter a valid email" });
			return false;
		}
		return true;
	}

	async function handleRequestOtp(e: React.FormEvent): Promise<void> {
		e.preventDefault();
		setErrors({});
		if (!validateEmail()) return;

		setIsLoading(true);
		try {
			const { error } = await authClient.emailOtp.sendVerificationOtp({
				email,
				type: "forget-password",
			});
			if (error) {
				toast.error(error.message ?? "Failed to send code");
			} else {
				setStep("verify");
				resendCooldown.start();
				toast.success("Reset code sent to your email");
			}
		} finally {
			setIsLoading(false);
		}
	}

	async function handleResend(): Promise<void> {
		if (resendCooldown.secondsLeft > 0) return;
		setIsLoading(true);
		try {
			const { error } = await authClient.emailOtp.sendVerificationOtp({
				email,
				type: "forget-password",
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

	async function handleResetPassword(e: React.FormEvent): Promise<void> {
		e.preventDefault();
		setErrors({});
		if (otp.length !== 6) return;
		if (!newPassword) {
			setErrors({ password: "Password is required" });
			return;
		}
		if (newPassword.length < 8) {
			setErrors({ password: "Password must be at least 8 characters" });
			return;
		}

		setIsLoading(true);
		try {
			const { error } = await authClient.emailOtp.resetPassword({
				email,
				otp,
				password: newPassword,
			});
			if (error) {
				toast.error(error.message ?? "Reset failed");
				setOtp("");
			} else {
				setStep("done");
				toast.success("Password reset successfully");
			}
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center p-4">
			<div className="w-full max-w-sm space-y-6">
				<div className="space-y-2 text-center">
					<h1 className="text-2xl font-bold">
						{step === "email"
							? "Reset your password"
							: step === "verify"
								? "Check your email"
								: "All set"}
					</h1>
					<p className="text-sm text-muted-foreground">
						{step === "email" && "Enter your email to receive a reset code"}
						{step === "verify" && (
							<>
								We sent a 6-digit code to{" "}
								<span className="font-medium text-foreground">{email}</span>
							</>
						)}
						{step === "done" && "Your new password is ready"}
					</p>
				</div>

				{step === "email" && (
					<form onSubmit={handleRequestOtp} className="space-y-4">
						<div className="space-y-2">
							<label htmlFor="email" className="text-sm font-medium">
								Email
							</label>
							<input
								id="email"
								type="email"
								value={email}
								onChange={(e) => {
									setEmail(e.target.value);
									setErrors({});
								}}
								className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								placeholder="you@example.com"
								autoComplete="email"
								autoFocus
							/>
							{errors.email && (
								<p className="text-xs text-destructive">{errors.email}</p>
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
								"Send reset code"
							)}
						</button>
					</form>
				)}

				{step === "verify" && (
					<form onSubmit={handleResetPassword} className="space-y-5">
						<div className="flex justify-center">
							<InputOTP
								maxLength={6}
								pattern={REGEXP_ONLY_DIGITS}
								value={otp}
								onChange={setOtp}
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
						<div className="space-y-2">
							<label htmlFor="new-password" className="text-sm font-medium">
								New password
							</label>
							<input
								id="new-password"
								type="password"
								value={newPassword}
								onChange={(e) => {
									setNewPassword(e.target.value);
									setErrors({});
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
							disabled={isLoading || otp.length !== 6}
							className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>
							{isLoading ? (
								<Loader2 className="mx-auto h-4 w-4 animate-spin" />
							) : (
								"Reset password"
							)}
						</button>
						<div className="flex items-center justify-between gap-2 text-sm">
							<button
								type="button"
								onClick={() => {
									setStep("email");
									setOtp("");
									setNewPassword("");
								}}
								className="text-muted-foreground hover:text-foreground"
							>
								Change email
							</button>
							<button
								type="button"
								onClick={handleResend}
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

				{step === "done" && (
					<div className="space-y-5">
						<div className="flex justify-center">
							<CheckCircle2
								className="h-12 w-12 text-primary"
								strokeWidth={1.5}
							/>
						</div>
						<Link
							to="/sign-in"
							className="block w-full rounded-md bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90"
						>
							Sign in now
						</Link>
					</div>
				)}

				{step !== "done" && (
					<p className="text-center text-sm text-muted-foreground">
						<Link to="/sign-in" className="hover:underline">
							Back to sign in
						</Link>
					</p>
				)}
			</div>
		</div>
	);
}
