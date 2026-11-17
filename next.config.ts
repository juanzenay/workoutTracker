import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `postgres` is a Node-only driver; keep it out of the bundler.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
