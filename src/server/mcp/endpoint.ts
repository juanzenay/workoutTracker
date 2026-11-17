import {
  createMcpHandler,
  OAuthError,
  OAuthErrorCode,
  requireBearerAuth,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import type { Commands } from "../commands";
import { buildMcpServer } from "./server";

export interface McpEndpointOptions {
  /** Verifies a bearer token (Supabase OAuth access token in production) → AuthInfo with `extra.userId`. */
  verifyAccessToken(token: string): Promise<AuthInfo>;
  /** The command layer acting as that user. */
  commandsFor(userId: string): Commands;
  /** RFC 9728 metadata URL advertised in 401 challenges, so clients can find the authorization server. */
  resourceMetadataUrl: string;
}

const userIdOf = (auth: AuthInfo | undefined) => {
  const userId = auth?.extra?.userId;
  if (typeof userId !== "string") throw new Error("MCP request without an authenticated user");
  return userId;
};

/**
 * The workout tracker MCP endpoint as a fetch handler: bearer-token gate (401 with a
 * WWW-Authenticate challenge), owner check through the command layer, then a
 * per-request stateless MCP server whose tools act as the owner.
 */
export function createMcpEndpoint({ verifyAccessToken, commandsFor, resourceMetadataUrl }: McpEndpointOptions) {
  const gate = requireBearerAuth({
    resourceMetadataUrl,
    verifier: {
      async verifyAccessToken(token) {
        const auth = await verifyAccessToken(token);
        const { isOwner } = await commandsFor(userIdOf(auth)).getAccount({});
        if (!isOwner) throw new OAuthError(OAuthErrorCode.InvalidToken, "Only the owner of this workout tracker deployment can connect");
        return auth;
      },
    },
  });
  const handler = createMcpHandler((ctx) => buildMcpServer(commandsFor(userIdOf(ctx.authInfo))));

  return async function serve(request: Request): Promise<Response> {
    const auth = await gate(request);
    if (auth instanceof Response) return auth;
    return handler.fetch(request, { authInfo: auth });
  };
}
