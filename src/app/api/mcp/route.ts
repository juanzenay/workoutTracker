import { mcpEndpoint } from "@/server/mcp/http";

/** workout tracker's remote MCP server (Streamable HTTP, stateless). Auth: Supabase OAuth bearer tokens, owner only. */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function serve(request: Request): Promise<Response> {
  return mcpEndpoint(request)(request);
}

export { serve as GET, serve as POST, serve as DELETE };
