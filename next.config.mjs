import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Web deployment (Hostinger Node app): a normal Next.js build, run with
  // `next start`. No standalone output — that was only for the desktop sidecar.
  // Expose the app version to the client (used by the sidebar label).
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
