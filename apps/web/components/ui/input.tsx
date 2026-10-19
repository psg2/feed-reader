import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const inputVariants = cva(
	"w-full min-w-0 text-sm outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-50",
	{
		variants: {
			variant: {
				default:
					"rounded-md border border-input bg-background px-3 read-only:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
				/** Borderless pill with room for a leading icon and a trailing clear button. */
				search:
					"rounded-md bg-accent/70 px-8 focus-visible:ring-2 focus-visible:ring-ring/40",
				/** No chrome: the field sits inside a container that draws it (tag chips). */
				bare: "bg-transparent px-1",
				/** One-time codes: large, centered and letter-spaced. */
				code: "rounded-md border border-input bg-background px-3 text-center font-mono text-lg tracking-code focus-visible:ring-2 focus-visible:ring-ring/40",
			},
			size: {
				default: "h-9",
				sm: "h-8",
				xs: "h-6",
				lg: "h-11",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Input({
	className,
	type,
	variant,
	size,
	...props
}: Omit<React.ComponentProps<"input">, "size"> &
	VariantProps<typeof inputVariants>) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(inputVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Input };
