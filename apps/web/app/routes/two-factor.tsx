import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/two-factor")({
	component: TwoFactorPage,
});

function TwoFactorPage() {
	const navigate = useNavigate();
	const [code, setCode] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [method, setMethod] = useState<"totp" | "backup">("totp");

	async function handleVerify(): Promise<void> {
		if (!code.trim()) return;

		setIsLoading(true);
		try {
			if (method === "backup") {
				const { error } = await authClient.twoFactor.verifyBackupCode({
					code: code.trim(),
				});
				if (error) {
					toast.error(error.message ?? "Invalid backup code");
					setCode("");
				} else {
					navigate({ to: "/reader" });
				}
			} else {
				const { error } = await authClient.twoFactor.verifyTotp({
					code: code.trim(),
				});
				if (error) {
					toast.error(error.message ?? "Invalid code");
					setCode("");
				} else {
					navigate({ to: "/reader" });
				}
			}
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center p-4">
			<div className="w-full max-w-sm space-y-6">
				<div className="flex flex-col items-center gap-3">
					<div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
						<ShieldCheck className="h-6 w-6 text-primary" />
					</div>
					<div className="space-y-1 text-center">
						<h1 className="text-2xl font-bold">
							{"Two-factor authentication"}
						</h1>
						<p className="text-sm text-muted-foreground">
							{method === "totp"
								? "Enter your 6-digit authenticator code"
								: "Enter one of your backup codes"}
						</p>
					</div>
				</div>

				<div className="space-y-4">
					<div className="flex justify-center">
						<Input
							type="text"
							inputMode={method === "totp" ? "numeric" : "text"}
							pattern={method === "totp" ? "^\\d+$" : undefined}
							maxLength={method === "totp" ? 6 : 20}
							value={code}
							onChange={(e) =>
								setCode(
									method === "totp"
										? e.target.value.replace(/\D/g, "")
										: e.target.value,
								)
							}
							variant="code"
							size="lg"
							className="w-48"
							placeholder={method === "totp" ? "000000" : "backup-code"}
						/>
					</div>

					<Button
						type="button"
						onClick={handleVerify}
						disabled={isLoading || !code.trim()}
						size="lg"
						className="w-full"
					>
						{isLoading ? (
							<Loader2 className="mx-auto h-4 w-4 animate-spin" />
						) : (
							"Verify"
						)}
					</Button>

					<Button
						type="button"
						onClick={() => {
							setMethod(method === "totp" ? "backup" : "totp");
							setCode("");
						}}
						variant="text"
						size="inline-sm"
						className="w-full"
					>
						{method === "totp"
							? "Use a backup code instead"
							: "Use authenticator app"}
					</Button>
				</div>
			</div>
		</div>
	);
}
