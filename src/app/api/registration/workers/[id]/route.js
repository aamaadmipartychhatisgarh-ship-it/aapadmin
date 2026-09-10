import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRegistrationAccess, NO_STORE } from "@/lib/registrationGuard";
import { newLinkToken, normalizeMobile } from "@/lib/registrationSchema";
import { phoneKey } from "@/lib/phone";

// Accept a valid Indian mobile, falling back to the last-10-digit key so a number
// in an unusual format is not rejected — the OTP gate matches on the same key, so
// this keeps a link's stored owner number usable by the gate.
function linkMobile(v) {
  const n = normalizeMobile(v);
  if (n) return n;
  const k = phoneKey(v);
  return k && k.length === 10 ? k : null;
}

// Edit one worker, rotate their link, or remove them.
//
// Rotating a token INVALIDATES the old link immediately (the old URL stops
// resolving) while every registration already collected keeps pointing at the
// same worker row — attribution survives a link rotation, which is the whole
// point of separating the two.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export async function PATCH(req, { params }) {
  try {
    const { error } = await requireRegistrationAccess();
    if (error) return error;
    const { id } = await params;
    const d = await req.json().catch(() => null);
    if (!d || typeof d !== "object") return NextResponse.json({ message: "Invalid request." }, { status: 400, headers: NO_STORE });

    const sets = [];
    const vals = [];
    const clip = (v, n) => { const s = String(v ?? "").trim(); return s ? s.slice(0, n) : null; };
    if (d.name !== undefined) {
      const name = String(d.name || "").trim();
      if (!name) return NextResponse.json({ message: "Worker name is required." }, { status: 400, headers: NO_STORE });
      sets.push("name = ?"); vals.push(name.slice(0, 160));
    }
    if (d.mobile !== undefined) {
      const m = String(d.mobile || "").trim();
      const norm = m ? linkMobile(m) : null;
      if (m && !norm) return NextResponse.json({ message: "Enter a valid 10-digit mobile number." }, { status: 400, headers: NO_STORE });
      sets.push("mobile = ?"); vals.push(norm);
    }
    if (d.ward_number !== undefined) { sets.push("ward_number = ?"); vals.push(clip(d.ward_number, 60)); }
    if (d.area_booth !== undefined) { sets.push("area_booth = ?"); vals.push(clip(d.area_booth, 160)); }
    if (d.status !== undefined && ["active", "disabled"].includes(d.status)) { sets.push("status = ?"); vals.push(d.status); }
    if (d.regenerate_token === true) { sets.push("token = ?"); vals.push(newLinkToken()); }
    if (!sets.length) return NextResponse.json({ message: "Nothing to update." }, { status: 400, headers: NO_STORE });

    await query(`UPDATE reg_workers SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);
    const [worker] = await query(`SELECT * FROM reg_workers WHERE id = ?`, [id]);
    if (!worker) return NextResponse.json({ message: "Not found." }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ worker }, { headers: NO_STORE });
  } catch (e) {
    console.error("[registration] worker PATCH error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

export async function DELETE(req, { params }) {
  try {
    const { error } = await requireRegistrationAccess({ superAdminOnly: true });
    if (error) return error;
    const { id } = await params;
    // A worker who has collected data is never deleted — that would orphan every
    // person they registered and silently shrink the drive's totals. Disable the
    // link instead, which stops new submissions and keeps the history intact.
    const [{ people }] = await query(`SELECT COUNT(*) AS people FROM reg_people WHERE worker_id = ?`, [id]);
    if (Number(people) > 0) {
      return NextResponse.json(
        { message: `This worker has ${people} registration${Number(people) === 1 ? "" : "s"}. Disable their link instead of deleting them.` },
        { status: 409, headers: NO_STORE }
      );
    }
    await query(`DELETE FROM reg_workers WHERE id = ?`, [id]);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    console.error("[registration] worker DELETE error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
