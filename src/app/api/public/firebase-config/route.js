import { NextResponse } from "next/server";
import { getFirebaseConfig } from "@/lib/firebaseVerify";

// GET /api/public/firebase-config
// Returns the Firebase WEB config for the client SDK. These values are NOT
// secrets — they are meant to ship to the browser — so exposing them is correct.
// Served from env / app_settings so the client works without a build-time env
// var. `configured:false` lets the form show a clear message instead of a crash.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  const c = await getFirebaseConfig();
  const configured = Boolean(c.FIREBASE_API_KEY && c.FIREBASE_PROJECT_ID && c.FIREBASE_AUTH_DOMAIN && c.FIREBASE_APP_ID);
  return NextResponse.json(
    {
      configured,
      apiKey: c.FIREBASE_API_KEY || "",
      authDomain: c.FIREBASE_AUTH_DOMAIN || "",
      projectId: c.FIREBASE_PROJECT_ID || "",
      appId: c.FIREBASE_APP_ID || "",
      messagingSenderId: c.FIREBASE_MESSAGING_SENDER_ID || "",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
