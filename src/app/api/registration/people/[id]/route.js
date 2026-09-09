import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRegistrationAccess, NO_STORE } from "@/lib/registrationGuard";
import { normalizeMobile, PERSON_TYPES, PERSON_STATUSES } from "@/lib/registrationSchema";

// Correct or triage one registration. Marking a row 'duplicate' / 'rejected'
// removes it from every count and ranking without erasing the record — the
// standard way to fix a bad entry, since deleting it would also erase the
// evidence of who submitted it.
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
      if (!name) return NextResponse.json({ message: "Name is required." }, { status: 400, headers: NO_STORE });
      sets.push("name = ?"); vals.push(name.slice(0, 160));
    }
    if (d.mobile !== undefined) {
      const m = normalizeMobile(d.mobile);
      if (!m) return NextResponse.json({ message: "Enter a valid 10-digit mobile number." }, { status: 400, headers: NO_STORE });
      sets.push("mobile = ?"); vals.push(m);
    }
    if (d.person_type !== undefined && PERSON_TYPES.includes(d.person_type)) {
      sets.push("person_type = ?, wants_worker = ?"); vals.push(d.person_type, d.person_type === "worker" ? 1 : 0);
    }
    if (d.worker_role !== undefined) { sets.push("worker_role = ?"); vals.push(clip(d.worker_role, 160)); }
    if (d.address !== undefined) { sets.push("address = ?"); vals.push(String(d.address || "").trim().slice(0, 2000) || null); }
    if (d.ward_number !== undefined) { sets.push("ward_number = ?"); vals.push(clip(d.ward_number, 60)); }
    if (d.area_booth !== undefined) { sets.push("area_booth = ?"); vals.push(clip(d.area_booth, 160)); }
    if (d.status !== undefined && PERSON_STATUSES.includes(d.status)) { sets.push("status = ?"); vals.push(d.status); }
    if (!sets.length) return NextResponse.json({ message: "Nothing to update." }, { status: 400, headers: NO_STORE });

    await query(`UPDATE reg_people SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);
    const [person] = await query(`SELECT * FROM reg_people WHERE id = ?`, [id]);
    if (!person) return NextResponse.json({ message: "Not found." }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ person }, { headers: NO_STORE });
  } catch (e) {
    console.error("[registration] person PATCH error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

export async function DELETE(req, { params }) {
  try {
    const { error } = await requireRegistrationAccess({ superAdminOnly: true });
    if (error) return error;
    const { id } = await params;
    await query(`DELETE FROM reg_people WHERE id = ?`, [id]);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    console.error("[registration] person DELETE error:", e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
