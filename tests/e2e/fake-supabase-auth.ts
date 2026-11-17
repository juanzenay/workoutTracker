/**
 * A minimal stand-in for Supabase Auth (GoTrue) for end-to-end tests, since the
 * full local Supabase stack can't run here. Implements just what workout tracker uses:
 * password sign-in, refresh, getUser (getClaims falls back to it for HS256
 * tokens) and logout, for the single owner account in ./owner.ts.
 *
 * Plus a sliver of Supabase's OAuth 2.1 server for the MCP connector flow:
 * /oauth/authorize (→ the app's /oauth/consent), the consent API the page
 * calls, /oauth/token (authorization_code) issuing ES256 access tokens with
 * `client_id`, and the JWKS the MCP endpoint verifies them with.
 */
import { createHmac, generateKeyPairSync, randomUUID, sign as signWith } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { E2E_APP_PORT, E2E_AUTH_PORT, E2E_OWNER } from "./owner";

const ISSUER = `http://127.0.0.1:${E2E_AUTH_PORT}/auth/v1`;
const oauthKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
const JWKS = { keys: [{ ...oauthKeys.publicKey.export({ format: "jwk" }), kid: "e2e-oauth", alg: "ES256", use: "sig" }] };

/** An access token as Supabase's OAuth server issues them (asymmetric, with client_id). */
function signOAuthToken(clientId: string) {
  const iat = Math.floor(Date.now() / 1000);
  const payload = {
    iss: ISSUER,
    sub: E2E_OWNER.id,
    aud: "authenticated",
    role: "authenticated",
    email: E2E_OWNER.email,
    client_id: clientId,
    scope: "openid email profile",
    session_id: randomUUID(),
    iat,
    exp: iat + 3600,
  };
  const body = `${b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "e2e-oauth" }))}.${b64url(JSON.stringify(payload))}`;
  const signature = signWith("sha256", Buffer.from(body), { key: oauthKeys.privateKey, dsaEncoding: "ieee-p1363" });
  return `${body}.${b64url(signature)}`;
}

/** Pending authorization requests (id → client + redirect) and issued codes (code → client). */
const authorizations = new Map<string, { clientId: string; redirectUri: string; state: string | null }>();
const codes = new Map<string, string>();

const SECRET = "workout-tracker-e2e-secret";
const b64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

function sign(payload: Record<string, unknown>): string {
  const body = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}`;
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}

function verify(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;
  const expected = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  if (expected !== signature) return null;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp: number };
  return claims.exp * 1000 > Date.now() ? claims : null;
}

const user = {
  id: E2E_OWNER.id,
  aud: "authenticated",
  role: "authenticated",
  email: E2E_OWNER.email,
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-10-11T00:00:00Z",
  updated_at: "2026-10-11T00:00:00Z",
};

function session() {
  const iat = Math.floor(Date.now() / 1000);
  const expiresIn = 3600;
  return {
    access_token: sign({
      sub: user.id,
      email: user.email,
      role: "authenticated",
      aud: "authenticated",
      session_id: randomUUID(),
      iat,
      exp: iat + expiresIn,
    }),
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: iat + expiresIn,
    refresh_token: randomUUID(),
    user,
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, string>> {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  if (req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(body));
  }
  return JSON.parse(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const send = (status: number, body?: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };

  if (url.pathname === "/health") return send(200, { ok: true });

  if (req.method === "POST" && url.pathname === "/auth/v1/token") {
    const body = await readJson(req);
    const grant = url.searchParams.get("grant_type");
    if (grant === "password" && body.email === E2E_OWNER.email && body.password === E2E_OWNER.password) {
      return send(200, session());
    }
    if (grant === "refresh_token" && body.refresh_token) return send(200, session());
    return send(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
  }

  if (req.method === "GET" && url.pathname === "/auth/v1/user") {
    const token = req.headers.authorization?.replace(/^Bearer /i, "");
    return verify(token) ? send(200, user) : send(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
  }

  if (req.method === "POST" && url.pathname === "/auth/v1/logout") return send(204);

  // ---- OAuth 2.1 server (MCP connector) ----
  if (req.method === "GET" && url.pathname === "/auth/v1/.well-known/jwks.json") return send(200, JWKS);

  if (req.method === "GET" && url.pathname === "/auth/v1/oauth/authorize") {
    const id = randomUUID();
    authorizations.set(id, {
      clientId: url.searchParams.get("client_id") ?? "",
      redirectUri: url.searchParams.get("redirect_uri") ?? "",
      state: url.searchParams.get("state"),
    });
    res.writeHead(302, { location: `http://127.0.0.1:${E2E_APP_PORT}/oauth/consent?authorization_id=${id}` });
    return res.end();
  }

  const consent = url.pathname.match(/^\/auth\/v1\/oauth\/authorizations\/([^/]+)(\/consent)?$/);
  if (consent) {
    const token = req.headers.authorization?.replace(/^Bearer /i, "");
    if (!verify(token)) return send(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    const authorization = authorizations.get(consent[1]!);
    if (!authorization) return send(404, { code: 404, error_code: "oauth_authorization_not_found", msg: "not found" });
    if (req.method === "GET" && !consent[2]) {
      return send(200, {
        authorization_id: consent[1],
        redirect_uri: authorization.redirectUri,
        client: { id: authorization.clientId, name: "Claude", uri: "https://claude.ai", logo_uri: "" },
        user: { id: user.id, email: user.email },
        scope: "openid email profile",
      });
    }
    if (req.method === "POST" && consent[2]) {
      const { action } = await readJson(req);
      authorizations.delete(consent[1]!);
      const redirect = new URL(authorization.redirectUri);
      if (action === "approve") {
        const code = randomUUID();
        codes.set(code, authorization.clientId);
        redirect.searchParams.set("code", code);
      } else {
        redirect.searchParams.set("error", "access_denied");
      }
      if (authorization.state) redirect.searchParams.set("state", authorization.state);
      return send(200, { redirect_url: redirect.toString() });
    }
  }

  if (req.method === "POST" && url.pathname === "/auth/v1/oauth/token") {
    const body = await readJson(req);
    const clientId = body.grant_type === "authorization_code" ? codes.get(body.code ?? "") : undefined;
    if (!clientId) return send(400, { error: "invalid_grant" });
    codes.delete(body.code!);
    return send(200, {
      access_token: signOAuthToken(clientId),
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: randomUUID(),
      scope: "openid email profile",
    });
  }

  send(404, { code: 404, msg: `fake auth: ${req.method} ${url.pathname} not implemented` });
});

server.listen(E2E_AUTH_PORT, "127.0.0.1");
