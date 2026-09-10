import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { phoneKey } from "@/lib/phone";
import { ensureWorkerFormSchema } from "@/lib/workerFormSchema";
import { readWorkerSession } from "@/lib/workerFormAuth";

// POST /api/worker-form/submit
// Requires a valid OTP session. Identity (worker id, name, phone) is derived from
// the session + `workers` — NEVER from the request body (§12, §13, §20). Any
// name/phone/worker_id sent by the client is ignored.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const NO_STORE = { "Cache-Control": "no-store" };
const json = (obj, status = 200) => NextResponse.json(obj, { status, headers: NO_STORE });

// Keys the client must never control — identity comes from the session only.
const RESERVED = new Set(["name", "phone", "mobile", "worker_id", "workerId", "worker_name", "id"]);

function sanitizeFormData(body) {
  const out = {};
  if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body)) {
      if (RESERVED.has(k)) continue;
      if (v == null) continue;
      // Bound each value so a submission can't be abused to store huge blobs.
      out[k] = typeof v === "string" ? v.slice(0, 4000) : v;
    }
  }
  return out;
}

export async function POST(req) {
  try {
    await ensureWorkerFormSchema();
    const s = readWorkerSession(req);
    if (!s?.wid) return json({ message: "Your session has expired. Please verify your phone number again." }, 401);

    // Re-confirm the worker is still a valid registered user (§7, §13).
    const [w] = await query(`SELECT id, name, mobile FROM workers WHERE id = ?`, [s.wid]);
    if (!w) return json({ message: "You are not registered." }, 403);

    const body = await req.json().catch(() => ({}));
    const formData = sanitizeFormData(body);

    await query(
      `INSERT INTO worker_form_submissions (worker_id, worker_name, phone, form_data) VALUES (?, ?, ?, ?)`,
      [w.id, w.name, phoneKey(w.mobile) || s.phone, JSON.stringify(formData)]
    );
    return json({ ok: true });
  } catch (err) {
    console.error("[worker-form] submit error:", err);
    return json({ message: "Could not submit the form. Please try again." }, 500);
  }
}
