/**
 * The origin the browser used to reach us. `request.url` reflects the address Next bound to
 * (e.g. localhost for `-H 127.0.0.1`), so redirects built from it can land on another host and
 * lose the session cookie; the Host header (or a proxy's X-Forwarded-*) is what the browser sent.
 */
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return url.origin;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(/:$/, "");
  return `${proto}://${host.split(",")[0]!.trim()}`;
}
