import { NextResponse } from "next/server";
import { getFirebaseConfigDetailed } from "@/lib/firebaseVerify";

// GET /api/public/firebase-config
// Returns the Firebase WEB config for the client SDK. These values are NOT
// secrets — they are meant to ship to the browser — so exposing them is correct.
// Served from env / app_settings so the client works without a build-time env
// var. `configured:false` lets the form show a clear message instead of a crash,
// and — crucially — this route now records a SAFE server-side diagnostic (never
// a config value) so a "not available" state is never silent (§10, §11).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  const { cfg, dbOk, dbError, missing, source, configured } = await getFirebaseConfigDetailed();

  console.log(
    `[firebase-config] loaded=${configured ? "YES" : "NO"} ` +
    `dbQueryOk=${dbOk ? "YES" : "NO"} ` +
    `projectIdPresent=${cfg.FIREBASE_PROJECT_ID ? "YES" : "NO"} ` +
    `missingKeys=[${missing.join(",")}] ` +
    `source={apiKey:${source.FIREBASE_API_KEY},authDomain:${source.FIREBASE_AUTH_DOMAIN},projectId:${source.FIREBASE_PROJECT_ID},appId:${source.FIREBASE_APP_ID}}` +
    (dbError ? ` dbError="${dbError}"` : "")
  );

  return NextResponse.json(
    {
      configured,
      // Key NAMES only — helps the operator without exposing any value.
      missing: configured ? [] : missing,
      apiKey: cfg.FIREBASE_API_KEY || "",
      authDomain: cfg.FIREBASE_AUTH_DOMAIN || "",
      projectId: cfg.FIREBASE_PROJECT_ID || "",
      appId: cfg.FIREBASE_APP_ID || "",
      messagingSenderId: cfg.FIREBASE_MESSAGING_SENDER_ID || "",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
