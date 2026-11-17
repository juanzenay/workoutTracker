import { OAuthError, OAuthErrorCode, type AuthInfo } from "@modelcontextprotocol/server";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Verifies access tokens issued by Supabase Auth's OAuth 2.1 server (what
 * Claude gets after the owner approves the connector on /oauth/consent):
 * signature via the project's JWKS (asymmetric signing keys), issuer, audience
 * "authenticated", expiry, and a `client_id` claim — so ordinary browser
 * session tokens are not accepted.
 */
export function createSupabaseTokenVerifier({
  supabaseUrl,
  keys = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)),
}: {
  supabaseUrl: string;
  /** Defaults to the project's published JWKS; tests pass a local key set. */
  keys?: JWTVerifyGetKey;
}) {
  const issuer = `${supabaseUrl.replace(/\/$/, "")}/auth/v1`;
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, keys, { issuer, audience: "authenticated" }));
      } catch (error) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, `Invalid access token: ${(error as Error).message}`);
      }
      if (typeof payload.client_id !== "string" || !payload.sub || typeof payload.exp !== "number") {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Not an OAuth access token");
      }
      return {
        token,
        clientId: payload.client_id,
        scopes: String(payload.scope ?? "")
          .split(" ")
          .filter(Boolean),
        expiresAt: payload.exp,
        extra: { userId: payload.sub },
      };
    },
  };
}
