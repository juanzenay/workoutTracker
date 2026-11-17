import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Exercise images are plain <img> so the service worker can cache them
      // for offline use; next/image's optimizer would route them via /_next/image.
      "@next/next/no-img-element": "off",
    },
  },
  globalIgnores([".claude/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "vendor/**", "public/sw.js"]),
]);
