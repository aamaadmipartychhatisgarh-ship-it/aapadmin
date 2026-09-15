import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import { getSettings, setSetting } from "@/lib/appSettings";
import { getFirebaseConfigDetailed } from "@/lib/firebaseVerify";

// Super-Admin-only integration settings (Firebase Phone Auth + SMS provider),
// stored in app_settings so OTP can be configured from the browser instead of
// SSH/scripts. The Firebase WEB config is not secret (it ships to the browser),
// so it is shown in full; the SMS provider API key IS secret, so only its
// presence (set/MISSING) is ever returned — never the value.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const NO_STORE = { "Cache-Control": "no-store" };
const json = (o, s = 200) => NextResponse.json(o, { status: s, headers: NO_STORE });

async function guard() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: json({ message: "Unauthorized" }, 401) };
  if (!isSuperAdmin(session)) return { error: json({ message: "Super Admin only." }, 403) };
  return { session };
}

export async function GET() {
  const { error } = await guard();
  if (error) return error;
  const fb = await getFirebaseConfigDetailed();
  const sms = await getSettings(["OTP_SMS_PROVIDER", "FAST2SMS_API_KEY"]).catch(() => ({}));
  return json({
    firebase: {
      apiKey: fb.cfg.FIREBASE_API_KEY || "",
      authDomain: fb.cfg.FIREBASE_AUTH_DOMAIN || "",
      projectId: fb.cfg.FIREBASE_PROJECT_ID || "",
      appId: fb.cfg.FIREBASE_APP_ID || "",
      messagingSenderId: fb.cfg.FIREBASE_MESSAGING_SENDER_ID || "",
      configured: fb.configured,
      missing: fb.missing,
    },
    sms: {
      provider: (process.env.OTP_SMS_PROVIDER || sms.OTP_SMS_PROVIDER || "").trim(),
      fast2smsKeySet: Boolean((process.env.FAST2SMS_API_KEY || sms.FAST2SMS_API_KEY || "").trim()),
    },
  });
}

export async function POST(req) {
  const { error } = await guard();
  if (error) return error;
  const body = await req.json().catch(() => ({}));

  // Save a value only when a non-empty string is provided, so blank fields never
  // wipe an existing setting. Values are trimmed (stray paste whitespace).
  const saveIf = async (key, val) => {
    if (typeof val === "string" && val.trim()) { await setSetting(key, val.trim()); return true; }
    return false;
  };

  const saved = [];
  const fb = body.firebase || {};
  const map = {
    FIREBASE_API_KEY: fb.apiKey, FIREBASE_AUTH_DOMAIN: fb.authDomain,
    FIREBASE_PROJECT_ID: fb.projectId, FIREBASE_APP_ID: fb.appId,
    FIREBASE_MESSAGING_SENDER_ID: fb.messagingSenderId,
  };
  for (const [k, v] of Object.entries(map)) { if (await saveIf(k, v)) saved.push(k); }

  const sms = body.sms || {};
  if (await saveIf("OTP_SMS_PROVIDER", sms.provider)) saved.push("OTP_SMS_PROVIDER");
  if (await saveIf("FAST2SMS_API_KEY", sms.fast2smsKey)) saved.push("FAST2SMS_API_KEY");

  // Return the refreshed status (no secret values) so the UI reflects reality.
  const after = await getFirebaseConfigDetailed();
  return json({ ok: true, savedKeys: saved, firebaseConfigured: after.configured, missing: after.missing });
}
