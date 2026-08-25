import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register MCP prompt templates — guided workflows for the AI.
 * Add new prompts here as you build features.
 */
export function registerPrompts(server: McpServer): void {
	server.registerPrompt(
		"create_post",
		{
			description: "Guide the user through creating a new post.",
		},
		() => ({
			messages: [
				{
					role: "user" as const,
					content: {
						type: "text" as const,
						text: "I want to create a new post.",
					},
				},
				{
					role: "assistant" as const,
					content: {
						type: "text" as const,
						text: [
							"I'll help you create a post! I need:",
							"",
							"1. **Title** — What should the post be called?",
							"2. **Content** (optional) — What's the post about?",
							"",
							"What title would you like?",
						].join("\n"),
					},
				},
			],
		}),
	);
}
