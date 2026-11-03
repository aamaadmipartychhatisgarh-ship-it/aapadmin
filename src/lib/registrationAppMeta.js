// Identity of the Worker & Voter Registration app (public pages /join and /r/<token>): ONE place for the app name, used by the page
// metadata (title, application name, Apple home-screen title) and the PWA manifest, so they can never disagree.
export const REGISTRATION_APP_NAME = "AAP";

export const registrationAppMetadata = {
  title: `${REGISTRATION_APP_NAME} — Worker & Voter Registration`,
  applicationName: REGISTRATION_APP_NAME,
  description: "Aam Aadmi Party Chhattisgarh — Worker & Voter Registration",
  manifest: "/registration-app.webmanifest",
  appleWebApp: { capable: true, title: REGISTRATION_APP_NAME, statusBarStyle: "default" },
  robots: { index: false, follow: false },
};
