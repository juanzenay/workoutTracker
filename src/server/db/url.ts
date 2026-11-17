/** Query parameters postgres.js understands; anything else it would send to the server as a setting (and fail). */
const KEEP = new Set(["sslmode", "application_name", "options", "connect_timeout"]);

/**
 * A connection string postgres.js can use. Vercel's Supabase integration appends parameters meant
 * for other drivers and the pooler (`supa=base-pooler.x`, `pgbouncer=true`, …); they are dropped.
 * The rest of the string (credentials included) is left byte for byte.
 */
export function postgresUrl(raw: string): string {
  const at = raw.indexOf("?");
  if (at === -1) return raw;
  const kept = raw
    .slice(at + 1)
    .split("&")
    .filter((pair) => KEEP.has(decodeURIComponent(pair.split("=")[0] ?? "")));
  return kept.length ? `${raw.slice(0, at)}?${kept.join("&")}` : raw.slice(0, at);
}
