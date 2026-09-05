import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosting target (Section 4.8): `standalone` emits .next/standalone with
  // a minimal server.js and only the traced node_modules — a Docker image that
  // doesn't carry the full dependency tree. public/ and .next/static are NOT
  // copied by the trace; the Dockerfile copies them in explicitly.
  output: "standalone",
};

export default nextConfig;
