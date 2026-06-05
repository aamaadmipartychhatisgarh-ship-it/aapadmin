/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output bundles a minimal self-contained Node server under
  // .next/standalone — this is what the Tauri sidecar launches at runtime.
  output: "standalone",
};

export default nextConfig;
