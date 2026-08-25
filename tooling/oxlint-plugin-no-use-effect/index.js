// Enforces the no-useEffect rule (see .agents/skills/no-use-effect).
// Use `useMountEffect` (or another replacement pattern) instead. To bypass
// at a specific call site:
//   // oxlint-disable-next-line no-use-effect/no-use-effect

const message =
	"Do not call useEffect directly. Use derived state, event handlers, a data-fetching library, or useMountEffect. See: .agents/skills/no-use-effect/SKILL.md";

const rule = {
	meta: { type: "problem" },
	create(context) {
		return {
			CallExpression(node) {
				const callee = node.callee;
				const isBare =
					callee.type === "Identifier" && callee.name === "useEffect";
				const isMember =
					callee.type === "MemberExpression" &&
					!callee.computed &&
					callee.property.type === "Identifier" &&
					callee.property.name === "useEffect";
				if (isBare || isMember) {
					context.report({ message, node });
				}
			},
		};
	},
};

export default {
	meta: { name: "no-use-effect" },
	rules: { "no-use-effect": rule },
};
