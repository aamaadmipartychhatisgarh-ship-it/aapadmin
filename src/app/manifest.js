// PWA web manifest — served at /manifest.webmanifest.
// Lets the browser offer "Install app" so the site runs in a standalone window
// (like YouTube Music / Spotify web).

export default function manifest() {
  return {
    name: "AAP Admin — Aam Aadmi Party, Chhattisgarh",
    short_name: "AAP Admin",
    description:
      "Aam Aadmi Party Chhattisgarh — Organization Management Dashboard",
    // The app opens on /launch, which moves into the dashboard INSIDE the app. (Opening /dashboard directly as a fresh page load
    // is what the hosting server was refusing with its own 403.) `id` stays /dashboard so installed copies keep their identity.
    id: "/dashboard",
    start_url: "/launch",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0B3A82",
    theme_color: "#0B3A82",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
