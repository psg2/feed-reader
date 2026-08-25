import { createFileRoute } from "@tanstack/react-router";
import { handleMcpRequest } from "@/server/mcp/handler";

async function handle({ request }: { request: Request }) {
	try {
		return await handleMcpRequest(request);
	} catch (err) {
		console.error("[MCP]", err);
		return Response.json({ error: "Internal server error" }, { status: 500 });
	}
}

export const Route = createFileRoute("/api/mcp")({
	server: {
		handlers: {
			GET: handle,
			POST: handle,
			DELETE: handle,
		},
	},
});
