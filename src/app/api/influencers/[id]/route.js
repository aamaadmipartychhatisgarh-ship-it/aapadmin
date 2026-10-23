import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { userCanAccessPageKey } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { ensureInfluencerSchema, getInfluencerColumns } from "@/lib/influencerSchema";
import { resolveContactCard, compactContactCard } from "@/lib/contactCard";
import { validate, coerce, shape, assertJoinedByStorable } from "../route";
import { findInfluencerByPhone, duplicatePhoneBody } from "@/lib/influencerPhone";
import { influencerPhoneKey } from "@/lib/influencerColumns";

// Every handler here is gated by the "influencers" page key (Super Admin +
// Supervisor by baseline, plus Page-Access grants), verified server-side (403
// otherwise), so influencer detail/update/delete is never reachable by an
// unauthorized role even if the client guard is bypassed.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

async function guard() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE }) };
  if (!(await userCanAccessPageKey(session, "influencers"))) return { error: NextResponse.json({ message: "Forbidden" }, { status: 403, headers: NO_STORE }) };
  return { session };
}

// GET /api/influencers/[id] → full profile.
export async function GET(_req, { params }) {
  try {
    const { error } = await guard();
    if (error) return error;
    await ensureInfluencerSchema();
    const { id } = await params;
    const iid = Number(id);
    if (!Number.isInteger(iid) || iid <= 0) return NextResponse.json({ message: "Invalid id." }, { status: 400, headers: NO_STORE });
    const [row] = await query("SELECT * FROM influencers WHERE id = ?", [iid]);
    if (!row) return NextResponse.json({ message: "Influencer not found." }, { status: 404, headers: NO_STORE });
    const shaped = shape(row);
    if (shaped.assigned_supervisor_id) {
      const [s] = await query("SELECT username FROM users WHERE id = ?", [shaped.assigned_supervisor_id]);
      shaped.assigned_supervisor_name = s?.username || null;
    }
    // Resolve the linked "Joined By" contact LIVE (never a stored copy), so edits to
    // that contact are always reflected. A since-deleted contact resolves to null.
    if (shaped.joined_by_contact_id) {
      shaped.joined_by_contact = compactContactCard(await resolveContactCard(shaped.joined_by_contact_id));
    }
    return NextResponse.json({ influencer: shaped }, { headers: NO_STORE });
  } catch (err) {
    console.error("[influencer] GET detail error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

// PUT /api/influencers/[id] → update (loads-and-replaces the full record; the
// client always sends the complete form, so no field is silently erased).
export async function PUT(req, { params }) {
  try {
    const { error } = await guard();
    if (error) return error;
    await ensureInfluencerSchema();
    const { id } = await params;
    const iid = Number(id);
    if (!Number.isInteger(iid) || iid <= 0) return NextResponse.json({ message: "Invalid id." }, { status: 400, headers: NO_STORE });
    const [existing] = await query("SELECT * FROM influencers WHERE id = ?", [iid]);
    if (!existing) return NextResponse.json({ message: "Influencer not found." }, { status: 404, headers: NO_STORE });

    const d = await req.json().catch(() => null);
    if (!d || typeof d !== "object") return NextResponse.json({ message: "Invalid request body." }, { status: 400, headers: NO_STORE });
    const verr = await validate(d);
    if (verr) return NextResponse.json({ message: verr }, { status: 400, headers: NO_STORE });

    // Pass the existing row so join/cancel dates are preserved correctly across a
    // status change (e.g. Joined → Cancelled keeps the original join date).
    const v = await coerce(d, existing);
    // Influence Type and Election "Position and Post" are intentionally NOT written
    // (the columns are retained — historical data preserved — but the module no
    // longer sets them), and created_by is never overwritten so the original Added
    // By is preserved on edit. The SET list is built from the columns that actually
    // exist on the table, so a never-migrated column is skipped rather than causing
    // an "Unknown column" 500 (mirrors the create path).
    const cols = await getInfluencerColumns();
    // Duplicate phone: only when the number was actually CHANGED to one that
    // normalizes differently. An unchanged number is never flagged (and its stored
    // key is left alone — a legacy duplicate keeps working), while a change onto
    // another influencer's number is refused (409) and nothing is saved.
    const phoneChanged = influencerPhoneKey(v.phone) !== influencerPhoneKey(existing.phone);
    if (!phoneChanged) delete v.phone_key;
    else {
      const dup = await findInfluencerByPhone(v.phone, iid);
      if (dup) return NextResponse.json(duplicatePhoneBody(dup), { status: 409, headers: NO_STORE });
    }
    const names = Object.keys(v).filter((k) => cols.has(k));
    if (!names.length) throw new Error("influencers table is missing expected columns");
    assertJoinedByStorable(v, cols);
    try {
      await query(
        `UPDATE influencers SET ${names.map((n) => `\`${n}\`=?`).join(", ")} WHERE id=?`,
        [...names.map((n) => v[n]), iid]
      );
    } catch (e) {
      if (e?.code === "ER_DUP_ENTRY" && /phone_key/.test(e?.message || "")) {
        return NextResponse.json(duplicatePhoneBody(await findInfluencerByPhone(v.phone, iid)), { status: 409, headers: NO_STORE });
      }
      throw e;
    }
    const [row] = await query("SELECT * FROM influencers WHERE id = ?", [iid]);
    if (!row) throw new Error("update reported success but the record could not be read back");
    const shaped = shape(row);
    if (shaped.joined_by_contact_id) shaped.joined_by_contact = compactContactCard(await resolveContactCard(shaped.joined_by_contact_id));
    return NextResponse.json({ influencer: shaped }, { headers: NO_STORE });
  } catch (err) {
    const detail = err?.sqlMessage || err?.message || String(err);
    console.error("[influencer] PUT error:", err?.code || "", detail);
    // Surface the real reason (admin/supervisor-only module) so an edit failure is
    // never hidden behind a generic message (Bug Fix §7).
    return NextResponse.json({ message: `Could not save the influencer: ${detail}` }, { status: 500, headers: NO_STORE });
  }
}

// DELETE /api/influencers/[id] → remove (Super-Admin verified server-side).
export async function DELETE(_req, { params }) {
  try {
    const { error } = await guard();
    if (error) return error;
    await ensureInfluencerSchema();
    const { id } = await params;
    const iid = Number(id);
    if (!Number.isInteger(iid) || iid <= 0) return NextResponse.json({ message: "Invalid id." }, { status: 400, headers: NO_STORE });
    const [existing] = await query("SELECT id FROM influencers WHERE id = ?", [iid]);
    if (!existing) return NextResponse.json({ message: "Influencer not found." }, { status: 404, headers: NO_STORE });
    await query("DELETE FROM influencers WHERE id = ?", [iid]);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error("[influencer] DELETE error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
