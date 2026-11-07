// A `beforeLoad` runs on every client navigation, so awaiting a server
// function there makes each page change wait on a server round trip after the
// URL has already changed. Route gates read the query cache via `loadGate`
// (apps/web/lib/load-gate.ts) and refresh it in the background instead.

const message =
	"Do not call a server function in beforeLoad: it blocks every navigation on a round trip. Wrap it in queryOptions and read it with loadGate (lib/load-gate.ts).";

const isServerFnModule = (source) => source.includes("/server-fns/");

const isGate = (node) =>
	node.key &&
	((node.key.type === "Identifier" && node.key.name === "beforeLoad") ||
		(node.key.type === "Literal" && node.key.value === "beforeLoad"));

const rule = {
	meta: { type: "problem" },
	create(context) {
		const serverFns = new Set();
		let gateDepth = 0;
		return {
			ImportDeclaration(node) {
				if (!isServerFnModule(String(node.source.value))) return;
				for (const s of node.specifiers) serverFns.add(s.local.name);
			},
			Property(node) {
				if (isGate(node)) gateDepth++;
			},
			"Property:exit"(node) {
				if (isGate(node)) gateDepth--;
			},
			CallExpression(node) {
				if (gateDepth === 0) return;
				const callee = node.callee;
				if (callee.type === "Identifier" && serverFns.has(callee.name)) {
					context.report({ message, node });
				}
			},
		};
	},
};

export default {
	meta: { name: "route-gates" },
	rules: { "cached-gate": rule },
};
