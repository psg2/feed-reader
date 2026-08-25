// Serves tests/fixtures/*.xml over http so the app server can "fetch" feeds
// without touching the internet. Any directory prefix is ignored, so
// /copy/lethain.xml is the same file at a different URL (a distinct feed).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.E2E_FIXTURE_PORT ?? 4567);
const dir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../tests/fixtures",
);

http
	.createServer((req, res) => {
		const name = path.basename(new URL(req.url ?? "/", "http://x").pathname);
		const file = path.join(dir, name);
		if (!name || !fs.existsSync(file)) {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("not found");
			return;
		}
		res.writeHead(200, { "content-type": "application/xml; charset=utf-8" });
		fs.createReadStream(file).pipe(res);
	})
	.listen(port, "127.0.0.1", () => {
		console.log(`fixture feeds on http://127.0.0.1:${port}`);
	});
