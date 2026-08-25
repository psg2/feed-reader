/**
 * Render scripts/og.html to apps/web/public/og-image.jpg at 1200×630 (Open
 * Graph spec). Run with `pnpm og:build`.
 *
 * Pipeline:
 *   1. playwright-core points at the system Chrome (no bundled browser —
 *      keeps the devDep small) and screenshots the local HTML at 1200×630
 *      as a PNG, captured at 2× for sharper text.
 *   2. sharp downsamples PNG → JPEG q=88 (mozjpeg). JPEG instead of PNG
 *      because OG doesn't need transparency and JPEG is ~4× smaller
 *      (matters for social-scraper fetch latency).
 *
 * Discovery order for Chrome:
 *   - PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH (env override)
 *   - macOS default: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
 *   - Linux defaults: /usr/bin/google-chrome, /usr/bin/chromium
 */
import { chromium } from "playwright-core";
import sharp from "sharp";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const sourceHtml = path.join(__dirname, "og.html");
const publicDir = path.join(repoRoot, "apps", "web", "public");
const outputJpg = path.join(publicDir, "og-image.jpg");
const tmpPng = path.join(publicDir, ".og-image.tmp.png");

const CHROME_CANDIDATES = [
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
	"/usr/bin/google-chrome",
	"/usr/bin/google-chrome-stable",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
].filter(Boolean);

async function findChrome() {
	for (const candidate of CHROME_CANDIDATES) {
		try {
			await fs.access(candidate);
			return candidate;
		} catch {
			/* keep looking */
		}
	}
	throw new Error(
		`Chrome not found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH or install Google Chrome / Chromium.\nLooked in:\n${CHROME_CANDIDATES.map((p) => `  ${p}`).join("\n")}`,
	);
}

async function main() {
	const executablePath = await findChrome();
	console.log(`→ chrome:    ${executablePath}`);
	console.log(`→ template:  ${sourceHtml}`);

	const browser = await chromium.launch({
		executablePath,
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	});
	try {
		const context = await browser.newContext({
			viewport: { width: 1200, height: 630 },
			deviceScaleFactor: 2,
		});
		const page = await context.newPage();
		await page.goto(pathToFileURL(sourceHtml).href, {
			waitUntil: "networkidle",
		});
		await page.evaluate(() => document.fonts.ready);
		await page.screenshot({
			path: tmpPng,
			type: "png",
			omitBackground: false,
		});
		console.log(`→ rendered:  ${tmpPng}`);
	} finally {
		await browser.close();
	}

	const info = await sharp(tmpPng)
		.resize(1200, 630)
		.jpeg({ quality: 88, mozjpeg: true })
		.toFile(outputJpg);
	await fs.unlink(tmpPng);
	console.log(
		`✓ wrote ${path.relative(repoRoot, outputJpg)} — ${info.width}×${info.height}, ${(info.size / 1024).toFixed(1)} KB`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
