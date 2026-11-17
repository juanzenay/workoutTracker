/**
 * Optimises the vendored wger muscle diagrams (vendor/wger-muscles) into
 * public/images/muscles, which the app serves (see src/domain/muscle-map.ts).
 * Re-run after updating the vendored SVGs:
 *
 *   npm run muscles:build
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { optimize } from "svgo";

const root = join(import.meta.dirname, "..");
const from = join(root, "vendor/wger-muscles");
const to = join(root, "public/images/muscles");

function build(source: string, target: string) {
  const { data } = optimize(readFileSync(source, "utf8"), { multipass: true });
  // The originals only carry width/height; a viewBox lets them scale.
  const withViewBox = data.replace(
    /^<svg([^>]*?) width="([\d.]+)" height="([\d.]+)"/,
    '<svg$1 width="$2" height="$3" viewBox="0 0 $2 $3"',
  );
  if (withViewBox === data) throw new Error(`No width/height on ${source}`);
  writeFileSync(target, withViewBox + "\n");
}

mkdirSync(to, { recursive: true });
build(join(from, "muscular_system_front.svg"), join(to, "front.svg"));
build(join(from, "muscular_system_back.svg"), join(to, "back.svg"));
for (const layer of ["main", "secondary"]) {
  mkdirSync(join(to, layer), { recursive: true });
  for (const file of readdirSync(join(from, layer)).filter((f) => f.endsWith(".svg"))) {
    build(join(from, layer, file), join(to, layer, file));
  }
}
console.log(`Wrote ${to}`);
