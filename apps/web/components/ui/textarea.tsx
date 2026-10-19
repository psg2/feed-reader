import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const textareaVariants = cva(
	"w-full rounded-md border border-input outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
	{
		variants: {
			variant: {
				default: "bg-background px-3 py-2 text-sm",
				/** The serif notes box under a post. */
				notes:
					"resize-y bg-background/60 p-3 font-serif text-title leading-relaxed",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Textarea({
	className,
	variant,
	...props
}: React.ComponentProps<"textarea"> & VariantProps<typeof textareaVariants>) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(textareaVariants({ variant, className }))}
			{...props}
		/>
	);
}

export { Textarea };
