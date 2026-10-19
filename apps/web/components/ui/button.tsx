import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-1.5 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 has-focus-visible:ring-2 has-focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"bg-primary font-medium text-primary-foreground not-disabled:hover:bg-primary/90",
				outline: "border border-input not-disabled:hover:bg-accent",
				"outline-muted":
					"border border-input text-muted-foreground not-disabled:hover:bg-accent not-disabled:hover:text-foreground",
				"outline-primary":
					"border border-primary/40 font-medium text-primary not-disabled:hover:bg-primary/10",
				ghost:
					"text-muted-foreground not-disabled:hover:bg-accent not-disabled:hover:text-foreground",
				"ghost-destructive":
					"text-muted-foreground not-disabled:hover:bg-accent not-disabled:hover:text-destructive",
				sidebar:
					"text-muted-foreground not-disabled:hover:bg-sidebar-accent not-disabled:hover:text-foreground",
				"sidebar-outline":
					"border border-input not-disabled:hover:bg-sidebar-accent",
				floating:
					"rounded-full border bg-popover shadow-md not-disabled:hover:bg-accent",
				"floating-primary":
					"rounded-full border border-dashed border-primary/50 bg-background/80 font-medium text-primary shadow-md backdrop-blur not-disabled:hover:bg-primary/10",
				text: "text-muted-foreground not-disabled:hover:text-foreground",
				link: "underline underline-offset-2 not-disabled:hover:text-foreground",
				"link-muted":
					"text-muted-foreground underline underline-offset-2 not-disabled:hover:text-foreground",
				plain: "",
			},
			size: {
				default: "h-9 px-4 text-sm",
				lg: "h-10 px-4 text-sm font-medium",
				bar: "h-10 gap-1 px-3 text-sm",
				sm: "h-8 px-3 text-sm",
				compact: "h-8 px-3 text-xs",
				xs: "h-7 px-3 text-xs",
				"2xs": "h-6 px-2 text-xs",
				chip: "h-auto px-2 py-0.5 text-xs",
				icon: "size-8",
				"icon-sm": "size-5.5 rounded",
				/** Sized by the surrounding text, for links inside a sentence. */
				inline: "h-auto p-0",
				"inline-sm": "h-auto p-0 text-sm",
				"inline-xs": "h-auto p-0 text-xs",
				/** Full-width list entry: icon, label, trailing meta. */
				row: "h-auto justify-start gap-2.5 px-3 py-2 text-left text-ui",
				/** The phone's list-header title that opens the nav drawer. */
				nav: "h-auto justify-start gap-2.5 py-1.5 pl-1",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	asChild = false,
	type = "button",
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot.Root : "button";

	return (
		<Comp
			data-slot="button"
			data-variant={variant}
			data-size={size}
			type={asChild ? undefined : type}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
