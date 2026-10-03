import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

// Self-service profile for an auto-provisioned member account. A member's name and
// phone live on the linked `contacts` row (users carries only a username), so this
// narrow endpoint reads/writes ONLY the caller's own linked contact — never role,
// scope or anyone else's record. Accounts with no linked contact (admins, callers)
// get { hasContact: false } and the editable section stays hidden.

async function linkedContactId(userId) {
  const [u] = await query("SELECT contact_id FROM users WHERE id = ?", [userId]);
  return u?.contact_id || null;
}

// GET → the caller's editable profile (name, phone, photo) or { hasContact:false }.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const contactId = await linkedContactId(session.user.id);
    if (!contactId) return NextResponse.json({ hasContact: false });
    const [c] = await query(
      "SELECT person_name, phone_number, photo_url FROM contacts WHERE id = ?",
      [contactId]
    );
    if (!c) return NextResponse.json({ hasContact: false });
    return NextResponse.json({ hasContact: true, name: c.person_name || "", phone: c.phone_number || "", photo_url: c.photo_url || null });
  } catch (e) {
    console.error("[me/profile] GET:", e?.message || e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

// PUT { name, phone } → update the caller's own linked contact. phone_number is
// UNIQUE, so a clash with another contact is reported cleanly rather than 500-ing.
export async function PUT(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const contactId = await linkedContactId(session.user.id);
    if (!contactId) return NextResponse.json({ message: "Your account has no editable profile." }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.replace(/\s+/g, "").trim() : "";
    if (!name) return NextResponse.json({ message: "Name is required." }, { status: 400 });
    if (!/^\d{10}$/.test(phone)) return NextResponse.json({ message: "Enter a valid 10-digit phone number." }, { status: 400 });

    // Guard the UNIQUE phone_number: a number already held by a DIFFERENT contact is
    // rejected with a clear message instead of a duplicate-key 500.
    const clash = await query("SELECT id FROM contacts WHERE phone_number = ? AND id <> ? LIMIT 1", [phone, contactId]);
    if (clash.length) return NextResponse.json({ message: "That phone number is already in use." }, { status: 409 });

    await query("UPDATE contacts SET person_name = ?, phone_number = ? WHERE id = ?", [name, phone, contactId]);
    return NextResponse.json({ ok: true, name, phone });
  } catch (e) {
    if (e?.code === "ER_DUP_ENTRY") return NextResponse.json({ message: "That phone number is already in use." }, { status: 409 });
    console.error("[me/profile] PUT:", e?.message || e);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
