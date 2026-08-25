export interface OpmlOutline {
	xmlUrl: string;
	title: string | null;
	htmlUrl: string | null;
	category: string | null;
}

const unesc = (s: string) =>
	s
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&apos;", "'")
		.replaceAll("&amp;", "&");

function attrs(tag: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
		out[m[1]] = unesc(m[2] ?? m[3] ?? "");
	}
	return out;
}

/**
 * Flattens `<outline xmlUrl>` nodes; the nearest folder outline (one without
 * xmlUrl) names the category. A tag tokenizer is enough for OPML, whose body
 * is nothing but nested outlines.
 */
export function parseOpml(xml: string): OpmlOutline[] {
	const out: OpmlOutline[] = [];
	const folders: string[] = [];
	for (const m of xml.matchAll(/<(\/?)outline\b([^>]*?)(\/?)>/gi)) {
		const [, closing, body, selfClosing] = m;
		if (closing) {
			folders.pop();
			continue;
		}
		const a = attrs(body);
		const xmlUrl = a.xmlUrl?.trim() ?? "";
		const label = a.title || a.text || null;
		if (xmlUrl) {
			out.push({
				xmlUrl,
				title: label,
				htmlUrl: a.htmlUrl || null,
				category: folders.at(-1) ?? null,
			});
		}
		if (!selfClosing)
			folders.push(xmlUrl ? (folders.at(-1) ?? "") : (label ?? ""));
	}
	return out;
}

const esc = (s: string) =>
	s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");

/** OPML 2.0 document; feeds with a category nest under a folder outline. */
export function buildOpml(
	feeds: Array<{
		title: string;
		url: string;
		siteUrl: string | null;
		category: string | null;
	}>,
	title = "Feed Reader subscriptions",
): string {
	const outline = (f: (typeof feeds)[number]) =>
		`<outline text="${esc(f.title)}" title="${esc(f.title)}" type="rss" xmlUrl="${esc(f.url)}"${
			f.siteUrl ? ` htmlUrl="${esc(f.siteUrl)}"` : ""
		}/>`;
	const groups = new Map<string | null, typeof feeds>();
	for (const f of feeds) {
		const key = f.category?.trim() || null;
		groups.set(key, [...(groups.get(key) ?? []), f]);
	}
	const lines: string[] = [];
	for (const f of groups.get(null) ?? []) lines.push(`\t\t${outline(f)}`);
	for (const [category, list] of groups) {
		if (category === null) continue;
		lines.push(
			`\t\t<outline text="${esc(category)}" title="${esc(category)}">`,
		);
		for (const f of list) lines.push(`\t\t\t${outline(f)}`);
		lines.push("\t\t</outline>");
	}
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<opml version="2.0">',
		"\t<head>",
		`\t\t<title>${esc(title)}</title>`,
		`\t\t<dateCreated>${new Date().toUTCString()}</dateCreated>`,
		"\t</head>",
		"\t<body>",
		...lines,
		"\t</body>",
		"</opml>",
		"",
	].join("\n");
}
