import { defineConfig, devices } from "@playwright/test";
import { E2E_APP_PORT, E2E_AUTH_PORT, E2E_DATABASE_URL } from "./tests/e2e/owner";

/**
 * End-to-end tests run against a production build (`next build && next start`)
 * wired to a local Postgres database and a fake Supabase Auth server.
 * Run with `npm run test:e2e` (needs local Postgres, like `npm test`). It rebuilds `.next`
 * with the e2e environment baked in, so don't deploy from that build.
 */
// Let context.route() see the service worker's own fetches (Chromium; otherwise they bypass it and e.g.
// catalogue images come from the live network). Offline mode still doesn't reliably reach a restarted
// worker, so tests that need the worker to see a dead network use tests/e2e/network-switch.ts.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

const appEnv = {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${E2E_AUTH_PORT}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "e2e-publishable-key",
  DATABASE_URL: E2E_DATABASE_URL,
  // A Strava app (fake credentials; never contacted): turns on the optional Strava UI, webhook and jobs.
  STRAVA_CLIENT_ID: "12345",
  STRAVA_CLIENT_SECRET: "e2e-client-secret",
  STRAVA_WEBHOOK_VERIFY_TOKEN: "e2e-verify-token",
  // Test-only VAPID pair (never used for a real deployment): turns on the "Enable notifications" UI.
  // E2E never subscribes a device, so nothing is sent to a push service.
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "BBxBTVduFMjM9CorLj27pTIMa2PFAcOi_42l8k2Lq3vBdBL7Vxr5n7Obtm81cuzKLi2JUzga1E6y7Emxpi1Z3XY",
  VAPID_PRIVATE_KEY: "qUiOxPUXFyx7QJ7Lgoh8mdDo0vpnqAwS7cSqfl4MXlc",
  VAPID_SUBJECT: "mailto:e2e@example.com",
};

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${E2E_APP_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  webServer: [
    {
      command: "npx tsx tests/e2e/fake-supabase-auth.ts",
      url: `http://127.0.0.1:${E2E_AUTH_PORT}/health`,
      reuseExistingServer: false,
    },
    {
      command: `npx next build && npx next start -p ${E2E_APP_PORT} -H 127.0.0.1`,
      // Not /sign-in: it reads the database, which globalSetup only creates once the servers are up.
      url: `http://127.0.0.1:${E2E_APP_PORT}/offline`,
      env: appEnv,
      timeout: 300_000,
      reuseExistingServer: false,
    },
  ],
});
