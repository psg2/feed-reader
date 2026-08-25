import { Mail, Rss } from "lucide-react";

/** Newsletters: e-mail feeds ingested by the server (`mailto:`) or a
 * Kill the Newsletter inbox feed. */
export const isNewsletter = (url: string) =>
	url.startsWith("mailto:") ||
	/^https?:\/\/(www\.)?kill-the-newsletter\.com\//i.test(url);

/** Envelope for newsletter feeds (mailto: URLs), RSS mark for the rest. */
export function FeedIcon({
	url,
	className = "h-4 w-4 shrink-0 text-muted-foreground",
}: {
	url: string;
	className?: string;
}) {
	return isNewsletter(url) ? (
		<Mail className={className} />
	) : (
		<Rss className={className} />
	);
}
