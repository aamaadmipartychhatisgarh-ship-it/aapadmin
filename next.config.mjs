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
  async headers() {
    return [
      {
        // Next.js defaults static pages to `s-maxage=31536000` (1 year),
        // assuming the CDN is purged on every deploy. Hostinger's CDN does
        // NOT auto-purge, so it kept serving year-old HTML that references
        // chunk files a later build already deleted -> ChunkLoadError / 404.
        // Force revalidation on HTML/RSC documents so the CDN always fetches
        // markup that points at the CURRENT build's chunks. Hashed assets
        // under /_next/static keep their own immutable long cache (excluded),
        // and /api/ is excluded too — see the dedicated rule below.
        source: "/((?!_next/|api/).*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      {
        // API responses carry per-user, always-changing data. They must never
        // be shared-cached (the `public` header above let Hostinger's CDN serve
        // a stale list — e.g. an old "assigned to" value after a reassignment).
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" },
        ],
      },
      {
        // A service worker must never be cached, or clients get stuck on an
        // old one (this is how the earlier broken sw.js lingered).
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
