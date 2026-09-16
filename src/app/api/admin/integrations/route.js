import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import { getSettings, setSetting } from "@/lib/appSettings";
import { smsConfigured, smsBalance, invalidateSmsConfig } from "@/lib/sms2factor";

// Super-Admin-only OTP settings: the 2Factor credentials, stored in app_settings
// so they can be set from the browser instead of the host's environment.
//
// That matters on this host specifically: its env-var API is a FULL REPLACE over
// masked values, so setting one variable means re-sending every other one blind —
// and a wrong NEXTAUTH_SECRET there logs every admin out. Configuring the key
// here touches nothing else. Environment variables still take precedence when
// present, so a host that can set them properly is never overridden.
//
// THE API KEY IS NEVER RETURNED. Only whether one is set, plus the live credit
// balance, which is the thing an operator actually needs to see.
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
  const db = await getSettings(["TWOFACTOR_API_KEY", "TWOFACTOR_SMS_TEMPLATE"]).catch(() => ({}));
  const configured = await smsConfigured();
  return json({
    sms: {
      provider: "2factor",
      // Presence only — the value never leaves the server.
      keySet: configured,
      // Which source won, so an operator can tell a stale database row from a
      // host variable when the two disagree.
      keyFrom: (process.env.TWOFACTOR_API_KEY || "").trim() ? "env" : (db.TWOFACTOR_API_KEY ? "database" : null),
      // The template name is not secret — it is a label registered with the
      // provider — so it is shown in full to be checked against their panel.
      template: (process.env.TWOFACTOR_SMS_TEMPLATE || db.TWOFACTOR_SMS_TEMPLATE || "").trim() || null,
      balance: configured ? await smsBalance() : null,
    },
  });
}

export async function POST(req) {
  const { error } = await guard();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const sms = body.sms || {};

  // A blank field never wipes an existing setting — otherwise loading the page
  // and pressing Save would silently clear the key, since the key is never sent
  // back to the browser to be re-submitted.
  const saved = [];
  const saveIf = async (key, val) => {
    if (typeof val === "string" && val.trim()) { await setSetting(key, val.trim()); saved.push(key); }
  };
  await saveIf("TWOFACTOR_API_KEY", sms.apiKey);
  await saveIf("TWOFACTOR_SMS_TEMPLATE", sms.template);

  // Drop the cached credentials so the next send uses what was just saved.
  invalidateSmsConfig();

  const configured = await smsConfigured();
  return json({ ok: true, savedKeys: saved, configured, balance: configured ? await smsBalance() : null });
}
