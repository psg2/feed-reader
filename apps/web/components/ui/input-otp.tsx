"use client";

import { OTPInput, OTPInputContext } from "input-otp";
import { MinusIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Six-slot verification-code input (shadcn pattern). Borders use --input + the
 * primary ring so each app's theme drives the active state. The fake caret
 * animates via the `animate-caret-blink` utility — globals.css ships a local
 * @keyframes as a safety net in case the tw-animate-css plugin doesn't expose
 * one for this project.
 */
function InputOTP({
	className,
	containerClassName,
	...props
}: React.ComponentProps<typeof OTPInput> & {
	containerClassName?: string;
}): React.ReactElement {
	return (
		<OTPInput
			data-slot="input-otp"
			containerClassName={cn(
				"flex items-center gap-2 has-disabled:opacity-50",
				containerClassName,
			)}
			className={cn("disabled:cursor-not-allowed", className)}
			{...props}
		/>
	);
}

function InputOTPGroup({
	className,
	...props
}: React.ComponentProps<"div">): React.ReactElement {
	return (
		<div
			data-slot="input-otp-group"
			className={cn("flex items-center", className)}
			{...props}
		/>
	);
}

function InputOTPSlot({
	index,
	className,
	...props
}: React.ComponentProps<"div"> & {
	index: number;
}): React.ReactElement {
	const inputOTPContext = React.useContext(OTPInputContext);
	const slot = inputOTPContext.slots[index];
	if (!slot) throw new Error(`OTP slot at index ${index} not found`);
	const { char, hasFakeCaret, isActive } = slot;

	return (
		<div
			data-slot="input-otp-slot"
			data-active={isActive}
			className={cn(
				"relative flex h-12 w-11 items-center justify-center border-y border-r border-input bg-background text-lg font-medium tabular-nums shadow-xs transition-all outline-none first:rounded-l-md first:border-l last:rounded-r-md",
				"data-[active=true]:z-10 data-[active=true]:border-ring data-[active=true]:ring-2 data-[active=true]:ring-ring/30",
				className,
			)}
			{...props}
		>
			{char}
			{hasFakeCaret && (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<div className="h-5 w-px animate-caret-blink bg-foreground duration-1000" />
				</div>
			)}
		</div>
	);
}

function InputOTPSeparator({
	...props
}: React.ComponentProps<"div">): React.ReactElement {
	return (
		// biome-ignore lint/a11y/useFocusableInteractive: decorative separator
		// biome-ignore lint/a11y/useSemanticElements: shadcn pattern
		// biome-ignore lint/a11y/useAriaPropsForRole: decorative only
		<div
			data-slot="input-otp-separator"
			role="separator"
			className="text-muted-foreground"
			{...props}
		>
			<MinusIcon className="h-3 w-3" />
		</div>
	);
}

export { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot };
