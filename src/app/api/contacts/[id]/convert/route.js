import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// Add a nullable column if it isn't there yet (idempotent, no manual migration).
async function ensureColumn(table, column, def) {
  try {
    const rows = await query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    if (Number(rows[0]?.n || 0) === 0) await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  } catch (e) { console.error(`[convert] ensureColumn ${table}.${column}:`, e?.message || e); }
}

// POST /api/contacts/[id]/convert  { target: "candidate" | "spokesperson" }
// Super Admin only. Creates a Candidate (Leader Assessment) or Spokesperson
// (Media) FROM the contact's existing data. The contact itself is never modified
// or deleted. Idempotent per contact+target: a `source_contact_id` link on the
// created record prevents a second click from making a duplicate.
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isSuperAdmin(session)) {
      return NextResponse.json({ message: "Only a Super Admin can convert contacts." }, { status: 403 });
    }
    const { id } = await params;
    if (!/^\d+$/.test(String(id))) return NextResponse.json({ message: "Invalid contact id." }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const target = String(body.target || "").toLowerCase();
    if (!["candidate", "spokesperson"].includes(target)) {
      return NextResponse.json({ message: "Choose Candidate or Spokesperson." }, { status: 400 });
    }

    const [contact] = await query(
      "SELECT id, person_name, phone_number, address, photo_url, assembly_id FROM contacts WHERE id = ?",
      [id]
    );
    if (!contact) return NextResponse.json({ message: "Contact not found." }, { status: 404 });
    const name = String(contact.person_name || "").trim();
    if (!name) return NextResponse.json({ message: "This contact has no name to convert." }, { status: 400 });

    // ----------------------------------------------------------- SPOKESPERSON
    if (target === "spokesperson") {
      await ensureColumn("spokespersons", "photo_url", "VARCHAR(1000) NULL");
      await ensureColumn("spokespersons", "source_contact_id", "INT NULL");
      const [dup] = await query("SELECT id, name FROM spokespersons WHERE source_contact_id = ? LIMIT 1", [id]);
      if (dup) {
        return NextResponse.json({ ok: true, already: true, target, id: dup.id, message: `"${dup.name}" is already a spokesperson (converted earlier).` });
      }
      const res = await query(
        "INSERT INTO spokespersons (name, mobile, photo_url, is_active, source_contact_id) VALUES (?, ?, ?, 1, ?)",
        [name, contact.phone_number || null, contact.photo_url || null, id]
      );
      return NextResponse.json({ ok: true, target, id: res.insertId, message: `"${name}" added as a Spokesperson.` }, { status: 201 });
    }

    // -------------------------------------------------------------- CANDIDATE
    // A candidate belongs to a Leader-Assessment assembly. Map the contact's
    // assembly (a locations id) to its la_assemblies row; without one there is no
    // assembly to attach the candidate to.
    if (!contact.assembly_id) {
      return NextResponse.json({ message: "This contact has no Assembly set, so it can't become a Candidate. Set the contact's Assembly first." }, { status: 400 });
    }
    const [la] = await query("SELECT id FROM la_assemblies WHERE location_id = ? LIMIT 1", [contact.assembly_id]);
    if (!la) {
      return NextResponse.json({ message: "This contact's Assembly isn't in Leader Assessment yet. Open that assembly in Leader Assessment once, then convert." }, { status: 400 });
    }
    await ensureColumn("la_aap_candidates", "source_contact_id", "INT NULL");
    const [dup] = await query("SELECT id, name FROM la_aap_candidates WHERE source_contact_id = ? LIMIT 1", [id]);
    if (dup) {
      return NextResponse.json({ ok: true, already: true, target, id: dup.id, message: `"${dup.name}" is already a candidate (converted earlier).` });
    }
    const res = await query(
      "INSERT INTO la_aap_candidates (assembly_id, name, phone, address, photo_url, source_contact_id) VALUES (?, ?, ?, ?, ?, ?)",
      [la.id, name, contact.phone_number || null, contact.address || null, contact.photo_url || null, id]
    );
    return NextResponse.json({ ok: true, target, id: res.insertId, message: `"${name}" added as a Candidate.` }, { status: 201 });
  } catch (e) {
    console.error("[contacts] convert:", e);
    return NextResponse.json({ message: "Conversion failed." }, { status: 500 });
  }
}
