import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createSupabaseTokenVerifier } from "./supabase-token";

const SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const OWNER = "6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  signingKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "ES256" };
  otherKey = (await generateKeyPair("ES256")).privateKey;
});

const now = () => Math.floor(Date.now() / 1000);

/** A Supabase OAuth access token as the Supabase OAuth server issues them. */
function token(claims: Record<string, unknown> = {}, key = signingKey) {
  return new SignJWT({
    sub: OWNER,
    aud: "authenticated",
    iss: ISSUER,
    role: "authenticated",
    email: "owner@example.com",
    client_id: "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d",
    scope: "openid email profile",
    iat: now(),
    exp: now() + 3600,
    ...claims,
  })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .sign(key);
}

const verifier = () => createSupabaseTokenVerifier({ supabaseUrl: SUPABASE_URL, keys: createLocalJWKSet({ keys: [jwk] }) });

describe("Supabase OAuth access token verifier", () => {
  it("accepts a token from the Supabase OAuth server: user id, client, scopes and expiry", async () => {
    const t = await token();
    const auth = await verifier().verifyAccessToken(t);
    expect(auth).toMatchObject({
      token: t,
      clientId: "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d",
      scopes: ["openid", "email", "profile"],
      extra: { userId: OWNER },
    });
    expect(auth.expiresAt).toBeGreaterThan(now());
  });

  it.each([
    ["signed by another key", () => token({}, otherKey)],
    ["expired", () => token({ iat: now() - 7200, exp: now() - 3600 })],
    ["from another project", () => token({ iss: "https://other.supabase.co/auth/v1" })],
    ["for another audience", () => token({ aud: "anon" })],
    ["a browser session token, not issued to an OAuth client", () => token({ client_id: undefined })],
    ["not a JWT", async () => "garbage"],
  ])("rejects a token %s as invalid_token", async (_, make) => {
    await expect(verifier().verifyAccessToken(await make())).rejects.toMatchObject({ code: "invalid_token" });
  });
});
