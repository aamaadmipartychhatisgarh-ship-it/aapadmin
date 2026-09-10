import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { phoneKey } from "@/lib/phone";
import { readWorkerSession } from "@/lib/workerFormAuth";

// GET /api/worker-form/session → whether the caller holds a valid OTP session,
// and (if so) the registered Name + Phone fetched fresh from `workers` — the
// authoritative identity the form auto-populates (§8, §9, §25).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const NO_STORE = { "Cache-Control": "no-store" };
const json = (obj, status = 200) => NextResponse.json(obj, { status, headers: NO_STORE });

export async function GET(req) {
  try {
    const s = readWorkerSession(req);
    if (!s?.wid) return json({ authenticated: false });
    const [w] = await query(`SELECT id, name, mobile FROM workers WHERE id = ?`, [s.wid]);
    if (!w) return json({ authenticated: false });
    return json({
      authenticated: true,
      worker: { id: w.id, name: w.name, phone: phoneKey(w.mobile) || s.phone },
    });
  } catch (err) {
    console.error("[worker-form] session error:", err);
    return json({ authenticated: false }, 200);
  }
}
