import { protectedResourceMetadata, siteUrl } from "@/server/mcp/http";

/** RFC 9728 Protected Resource Metadata for the MCP endpoint (both the bare and the path-aware /api/mcp URL). */
export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
};

export function GET(request: Request) {
  return Response.json(protectedResourceMetadata(siteUrl(request)), {
    headers: { ...CORS, "cache-control": "public, max-age=3600" },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
