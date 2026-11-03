// PWA manifest of the Worker & Voter Registration app (/join and /r/<token>) - served at /registration-app.webmanifest.
// The installed name and the label under the icon are both "AAP". It is a separate install from the admin app
// (/manifest.webmanifest, "AAP Admin"): its own id and start_url, so installing one never replaces the other.
import { REGISTRATION_APP_NAME } from "@/lib/registrationAppMeta";

export const dynamic = "force-static";

export function GET() {
  const manifest = {
    id: "/join",
    name: REGISTRATION_APP_NAME,
    short_name: REGISTRATION_APP_NAME,
    description: "Aam Aadmi Party Chhattisgarh — Worker & Voter Registration",
    start_url: "/join",
    scope: "/",
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
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "no-cache, must-revalidate" },
  });
}
