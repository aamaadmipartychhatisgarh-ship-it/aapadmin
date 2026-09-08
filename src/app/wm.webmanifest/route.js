// Scoped Web App Manifest for the Worker & Membership PWA, served at
// /wm.webmanifest. start_url + scope = /wm, so the installed app launches
// directly into the Worker & Membership experience and stays within it — it does
// NOT open the main dashboard or any other module (§22, §23, §27). Uses the same
// AAP Chhattisgarh icons as the main app (§28) and the same origin/backend (§24).
export const dynamic = "force-static";

export function GET() {
  const manifest = {
    id: "/wm",
    name: "AAP Chhattisgarh — Worker & Membership",
    short_name: "Worker & Membership",
    description: "Worker & Membership Management for AAP Chhattisgarh — Super Admin.",
    start_url: "/wm",
    scope: "/wm",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0B3A82",
    theme_color: "#0B3A82",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
