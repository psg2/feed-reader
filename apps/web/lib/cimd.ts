import { fetchClientMetadataResource as fetchOverPinnedConnection } from "@better-auth/cimd/node";
import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { env, getAppUrl } from "./env";

/**
 * Client ID Metadata Document for a stand-in MCP client. `.test` never
 * resolves, so outside production the transport answers it in-process — the
 * pattern the CIMD docs give for tests — letting tests and local MCP Inspector
 * runs authorize without a publicly hosted document.
 */
export const TEST_MCP_CLIENT_ID = "https://mcp-client.test/client.json";

const fetchTestClientMetadata: ClientMetadataResourceFetch = (input, init) => {
	const url = input instanceof Request ? input.url : String(input);
	if (url !== TEST_MCP_CLIENT_ID) {
		return fetchOverPinnedConnection(input, init);
	}
	return Response.json({
		client_id: TEST_MCP_CLIENT_ID,
		client_name: "MCP test client",
		redirect_uris: [`${getAppUrl()}/oauth/callback`],
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		token_endpoint_auth_method: "none",
	});
};

export const fetchClientMetadataResource: ClientMetadataResourceFetch =
	env.NODE_ENV === "production"
		? fetchOverPinnedConnection
		: fetchTestClientMetadata;
