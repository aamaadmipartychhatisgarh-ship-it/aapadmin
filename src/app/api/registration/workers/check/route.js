import { NextResponse } from "next/server";
import { requireRegistrationAccess, NO_STORE } from "@/lib/registrationGuard";
import { regPhoneKey, findExistingWorker, findContactByPhoneKey, ALREADY_A_WORKER } from "@/lib/registrationMatch";

export const dynamic = "force-dynamic";

// GET ?mobile=&campaign_id= - live check while a Worker is being created: is this (normalised) number
// already a Worker, and is there an existing Contact it will be linked to? The POST re-checks everything
// server-side; this only lets the form say so before submitting.
export async function GET(req) {
  const { error } = await requireRegistrationAccess();
  if (error) return error;
  const sp = new URL(req.url).searchParams;
  const key = regPhoneKey(sp.get("mobile"));
  const campaignId = /^\d+$/.test(sp.get("campaign_id") || "") ? Number(sp.get("campaign_id")) : null;
  if (!key || !campaignId) return NextResponse.json({ already_worker: false, contact: null }, { headers: NO_STORE });
  const w = await findExistingWorker(campaignId, key);
  const c = w ? null : await findContactByPhoneKey(key);
  return NextResponse.json(
    { already_worker: !!w, message: w ? ALREADY_A_WORKER : null, contact: c ? { id: c.id, name: c.person_name } : null },
    { headers: NO_STORE }
  );
}
