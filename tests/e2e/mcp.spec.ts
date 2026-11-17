import { createHash, randomBytes } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { E2E_AUTH_PORT, E2E_DATABASE_URL, E2E_OWNER } from "./owner";

const AUTH_SERVER = `http://127.0.0.1:${E2E_AUTH_PORT}/auth/v1`;
const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

/**
 * Claude connecting workout tracker as a custom connector: discovery from the 401
 * challenge, the owner approving on workout tracker's consent page (signing in first),
 * the code-for-token exchange with (fake) Supabase Auth, then MCP tool calls
 * with the bearer token.
 */
test("Claude connects through Supabase OAuth with the owner's approval, reads races and applies an approved change over MCP", async ({ page, request, baseURL }) => {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`insert into public.races (name, date, distance_meters, priority) values ('MCP Marathon', '2030-05-05', 42195, 'A')`;

    // 1. Unauthenticated MCP request → 401 pointing at the protected resource metadata.
    const challenge = await request.post("/api/mcp", {
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(challenge.status()).toBe(401);
    const metadataUrl = challenge.headers()["www-authenticate"]!.match(/resource_metadata="([^"]+)"/)![1]!;
    expect(metadataUrl).toBe(`${baseURL}/.well-known/oauth-protected-resource/api/mcp`);

    // 2. The metadata names Supabase Auth as the authorization server.
    const metadata = await (await request.get(metadataUrl)).json();
    expect(metadata).toMatchObject({ resource: `${baseURL}/api/mcp`, authorization_servers: [AUTH_SERVER] });

    // 3. Authorize: Supabase sends the browser to workout tracker's consent page; the owner signs in, then approves.
    let callback: URL | undefined;
    await page.route("https://claude.ai/**", (route) => {
      callback = new URL(route.request().url());
      return route.fulfill({ status: 200, body: "connected" });
    });
    const verifier = randomBytes(32).toString("base64url");
    const authorize = new URL(`${metadata.authorization_servers[0]}/oauth/authorize`);
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: "claude-e2e",
      redirect_uri: CLAUDE_CALLBACK,
      state: "s1",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    await page.goto(authorize.toString());
    await page.waitForURL((url) => url.pathname === "/sign-in");
    await page.getByLabel("Email").fill(E2E_OWNER.email);
    await page.getByLabel("Password").fill(E2E_OWNER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => url.pathname === "/oauth/consent");
    await expect(page.getByRole("heading", { name: "Connect your coach" })).toBeVisible();
    await expect(page.getByText("Claude wants to coach your training in workout tracker.")).toBeVisible();
    await page.getByRole("button", { name: "Allow" }).click();
    await expect.poll(() => callback?.toString()).toContain(CLAUDE_CALLBACK);
    expect(callback!.searchParams.get("state")).toBe("s1");
    const code = callback!.searchParams.get("code")!;

    // 4. Code → access token.
    const tokens = await (
      await request.post(`${AUTH_SERVER}/oauth/token`, {
        form: { grant_type: "authorization_code", code, redirect_uri: CLAUDE_CALLBACK, client_id: "claude-e2e", code_verifier: verifier },
      })
    ).json();

    // 5. MCP with the bearer token.
    const transport = new StreamableHTTPClientTransport(new URL(`${baseURL}/api/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
    });
    const client = new Client({ name: "e2e", version: "1.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["get_calendar", "list_races"]));
      const result = await client.callTool({ name: "list_races", arguments: {} });
      expect(result.structuredContent).toMatchObject({ races: [expect.objectContaining({ name: "MCP Marathon" })] });

      // 6. The coach proposes, the owner approves in chat, the change applies: a "Plan updated" card on Analytics, undoable there.
      const proposal = await client.callTool({
        name: "add_race",
        arguments: { name: "Coach 10K", date: "2030-06-02", distanceMeters: 10_000, priority: "C" },
      });
      const { changeId } = proposal.structuredContent as { changeId: string };
      await client.callTool({ name: "apply_change", arguments: { changeId } });
      await page.goto("/analytics");
      const card = page.getByRole("article", { name: "New C race: Coach 10K on Sunday, Jun 2" });
      await expect(card).toContainText("Plan updated · From your coach");
      await card.getByRole("button", { name: "Undo" }).click();
      await expect(card).toBeHidden();
      await expect.poll(async () => (await sql`select 1 from public.races where name = 'Coach 10K'`).length).toBe(0);
    } finally {
      await client.close();
    }

    // A browser session token (not issued to an OAuth client) is refused.
    const session = await (
      await request.post(`${AUTH_SERVER}/token?grant_type=password`, { data: { email: E2E_OWNER.email, password: E2E_OWNER.password } })
    ).json();
    const refused = await request.post("/api/mcp", {
      headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(refused.status()).toBe(401);
  } finally {
    await sql`delete from public.races where name in ('MCP Marathon', 'Coach 10K')`;
    await sql`delete from public.plan_revisions where source = 'coach'`;
    await sql`delete from public.inbox_items where url like '/plan-changes/%'`;
    await sql.end();
  }
});
