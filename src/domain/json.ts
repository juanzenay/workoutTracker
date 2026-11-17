/** Deep equality of JSON values regardless of key order (jsonb reorders keys); undefined properties don't count. */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([k, x]) => [k, canonical(x)]),
  );
}
