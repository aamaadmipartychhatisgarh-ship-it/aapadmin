import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRegistrationAccess, NO_STORE } from "@/lib/registrationGuard";
import { newLinkToken, workerCodeFor, normalizeMobile } from "@/lib/registrationSchema";
import { phoneKey, last10Sql } from "@/lib/phone";
import { buildRegCredentials } from "@/lib/regCredentials";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// A worker link must carry a usable 10-digit mobile (the login/OTP flow keys on it).
function linkMobile(v) {
  const n = normalizeMobile(v);
  if (n) return n;
  const k = phoneKey(v);
  return k && k.length === 10 ? k : null;
}

// POST { contact_id }  —  Generate (or REUSE) a Worker & Voter Registration link
// for an existing Contact (§Contacts↔Registration integration). The Contact is the
// source of truth: its name + phone are reused, and the worker row keeps the stable
// contact_id so the roster/registration always resolve back to the same Contact
// (and its live photo). Idempotent: the same Contact never spawns a second worker /
// User ID / link.
export async function POST(req) {
  try {
    const { error } = await requireRegistrationAccess();
    if (error) return error;
    const d = await req.json().catch(() => null);
    const contactId = /^\d+$/.test(String(d?.contact_id || "")) ? Number(d.contact_id) : null;
    if (!contactId) return NextResponse.json({ message: "No contact selected." }, { status: 400, headers: NO_STORE });

    // The active drive the link belongs to (registration must be open).
    const [campaign] = await query(
      `SELECT id FROM reg_campaigns WHERE status = 'active' ORDER BY created_at DESC, id DESC LIMIT 1`
    );
    if (!campaign) {
      return NextResponse.json({ message: "Registration is not open right now. Turn on the common registration link first." }, { status: 400, headers: NO_STORE });
    }
    const campaignId = campaign.id;

    // The Contact record — its name, phone and resolved photo (its own, else its
    // linked field-worker's). This is the ONLY place the details come from.
    const [contact] = await query(
      `SELECT c.id, c.person_name AS name, c.phone_number AS phone,
              COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(w.photo_url), '')) AS photo_url
         FROM contacts c LEFT JOIN workers w ON w.id = c.worker_id
        WHERE c.id = ? LIMIT 1`,
      [contactId]
    );
    if (!contact) return NextResponse.json({ message: "That contact no longer exists." }, { status: 404, headers: NO_STORE });

    // §13 — a valid phone is required; never mint a broken login account.
    const mobile = linkMobile(contact.phone);
    if (!mobile) {
      return NextResponse.json(
        { message: "This contact has no valid 10-digit phone number. Update the contact's phone number, then generate the link." },
        { status: 400, headers: NO_STORE }
      );
    }

    // Idempotency (§11): reuse an existing worker for this Contact — matched first by
    // the stable contact_id, else by the same mobile in this drive. Never duplicate.
    const [existing] = await query(
      `SELECT id, name, worker_code, username, status, contact_id
         FROM reg_workers
        WHERE campaign_id = ? AND (contact_id = ? OR ${last10Sql("mobile")} = ?)
        ORDER BY (contact_id = ?) DESC, id ASC LIMIT 1`,
      [campaignId, contactId, mobile, contactId]
    );
    if (existing) {
      // Backfill the stable link if this row was matched only by mobile.
      if (!existing.contact_id) {
        await query(`UPDATE reg_workers SET contact_id = ? WHERE id = ?`, [contactId, existing.id]);
      }
      return NextResponse.json(
        {
          reused: true,
          link: "/join",
          worker: { id: existing.id, name: existing.name, mobile, worker_code: existing.worker_code, username: existing.username, status: existing.status, contact_id: contactId, photo_url: contact.photo_url || null },
          credentials: null, // the password was issued when the account was first created
        },
        { headers: NO_STORE }
      );
    }

    // Fresh account — User ID (= tidied Name) + password by the existing rules.
    const cred = buildRegCredentials(contact.name, mobile);
    if (cred.error) return NextResponse.json({ message: cred.error }, { status: 400, headers: NO_STORE });
    const name = cred.username.slice(0, 160); // tidied Name = username

    // Username (= Name) is unique within the drive: a different person with the same
    // name is rejected, so two accounts never share one login identity.
    const [clash] = await query(
      `SELECT id FROM reg_workers WHERE campaign_id = ? AND username = ? LIMIT 1`,
      [campaignId, name]
    );
    if (clash) {
      return NextResponse.json({ message: `A different karyakarta named "${name}" already has a link. Rename one of them first.` }, { status: 409, headers: NO_STORE });
    }

    const passwordHash = await bcrypt.hash(cred.password, 10);
    const res = await query(
      `INSERT INTO reg_workers (campaign_id, contact_id, name, mobile, token, username, password_hash, password_set_at, created_by)
       VALUES (?,?,?,?,?,?,?,NOW(),?)`,
      [campaignId, contactId, name, mobile, newLinkToken(), name, passwordHash, null]
    );
    const workerId = res.insertId;
    await query(`UPDATE reg_workers SET worker_code = ? WHERE id = ?`, [workerCodeFor(name, workerId), workerId]);
    const [row] = await query(`SELECT id, name, mobile, worker_code, username, status FROM reg_workers WHERE id = ?`, [workerId]);

    return NextResponse.json(
      {
        reused: false,
        link: "/join",
        worker: { ...row, contact_id: contactId, photo_url: contact.photo_url || null },
        credentials: { username: cred.username, password: cred.password }, // shown once
      },
      { status: 201, headers: NO_STORE }
    );
  } catch (e) {
    console.error("[registration] from-contact error:", e);
    return NextResponse.json({ message: "Could not generate the link. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
