import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output bundles a minimal self-contained Node server under
  // .next/standalone — this is what the Tauri sidecar launches at runtime.
  output: "standalone",
  // Expose the app version to the client so the sidebar can display it
  // (works in browser and desktop, no Tauri permission needed).
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
