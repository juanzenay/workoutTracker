import "server-only";
import { createCommands } from "../commands";
import { supabaseEnv } from "../auth/supabase";
import { getSql } from "../db/client";
import { createMcpEndpoint } from "./endpoint";
import { createSupabaseTokenVerifier } from "./supabase-token";

/** Path of the MCP endpoint (the URL the owner pastes into Claude's custom connector dialog). */
export const MCP_PATH = "/api/mcp";

/**
 * Public origin of this deployment. `SITE_URL` (e.g. https://workout-tracker-you.vercel.app) wins;
 * otherwise the host the request was sent to (Vercel sets x-forwarded-host/proto).
 */
export function siteUrl(request: Request): string {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

/** RFC 9728 Protected Resource Metadata: tells Claude that Supabase Auth issues tokens for this server. */
export function protectedResourceMetadata(site: string) {
  return {
    resource: `${site}${MCP_PATH}`,
    authorization_servers: [`${supabaseEnv().url.replace(/\/$/, "")}/auth/v1`],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "email", "profile"],
    resource_name: "Workout Tracker",
  };
}

export const resourceMetadataUrl = (site: string) => `${site}/.well-known/oauth-protected-resource${MCP_PATH}`;

const endpoints = new Map<string, (request: Request) => Promise<Response>>();

/** The MCP endpoint for this deployment, wired to Supabase Auth and the real command layer. */
export function mcpEndpoint(request: Request) {
  const site = siteUrl(request);
  let endpoint = endpoints.get(site);
  if (!endpoint) {
    endpoint = createMcpEndpoint({
      verifyAccessToken: createSupabaseTokenVerifier({ supabaseUrl: supabaseEnv().url }).verifyAccessToken,
      commandsFor: (userId) => createCommands({ sql: getSql(), actor: { kind: "user", userId } }),
      resourceMetadataUrl: resourceMetadataUrl(site),
    });
    endpoints.set(site, endpoint);
  }
  return endpoint;
}
