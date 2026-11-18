import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isSupervisorRole } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { supervisorScopeFilter } from "@/lib/supervisorScope";
import { ensureRegistrationSchema } from "@/lib/registrationSchema";
import { requireRegistrationAccess, NO_STORE } from "@/lib/registrationGuard";
import { newLinkToken, workerCodeFor, normalizeMobile } from "@/lib/registrationSchema";
import { phoneKey, last10Sql } from "@/lib/phone";
import { buildRegCredentials } from "@/lib/regCredentials";
import { withNamedLock } from "@/lib/registrationMatch";

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
// (and its live photo). Duplicates are identified by the MOBILE NUMBER ONLY: a number
// that already has a worker is refused with a duplicate error; a shared name is fine.
export async function POST(req) {
  try {
    // A Supervisor generates links through the same logic as an Admin, but through their own capability
    // ("contact_registration_link", held by role, switchable in Page Access) and ONLY for contacts inside their territory.
    // Everyone else keeps the registration-module gate exactly as before.
    const sess = await getServerSession(authOptions);
    const supervisor = !!sess && isSupervisorRole(sess);
    if (supervisor) {
      if (!(await pageAllowed(sess, "contact_registration_link", true))) {
        return NextResponse.json({ message: "You do not have permission to generate registration links." }, { status: 403, headers: NO_STORE });
      }
      await ensureRegistrationSchema();
    } else {
      const { error } = await requireRegistrationAccess();
      if (error) return error;
    }
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
    if (supervisor) {
      // Territory: the contact must be one this Supervisor can see (same scope filter as their Contacts list); otherwise it is
      // reported exactly like a missing contact, never revealing it.
      const sc = supervisorScopeFilter(sess.user, "c");
      const [inScope] = await query(`SELECT 1 AS ok FROM contacts c WHERE c.id = ? ${sc.where} LIMIT 1`, [contactId, ...sc.params]);
      if (!inScope) return NextResponse.json({ message: "That contact is outside your territory." }, { status: 403, headers: NO_STORE });
    }

    // §13 — a valid phone is required; never mint a broken login account.
    const mobile = linkMobile(contact.phone);
    if (!mobile) {
      return NextResponse.json(
        { message: "This contact has no valid 10-digit phone number. Update the contact's phone number, then generate the link." },
        { status: 400, headers: NO_STORE }
      );
    }

    // DUPLICATE CHECK — by MOBILE NUMBER ONLY. The number is normalised first (country code, spaces, dashes, a leading 0 all
    // reduce to the same 10 digits) and compared with every worker of the drive on the same normalised key, so formatting can
    // never slip a second link through. A name is never a reason to refuse: several workers may share a name. An existing
    // worker with this mobile (this Contact's own link, or anyone else's) is a duplicate: nothing is created and the existing
    // worker is named. The check and the insert run under a per-(drive, number) lock shared with the Generate-links form, and
    // the UNIQUE (drive, mobile) key is the final backstop.
    const cred = buildRegCredentials(contact.name, mobile);
    if (cred.error) return NextResponse.json({ message: cred.error }, { status: 400, headers: NO_STORE });
    const name = cred.username.slice(0, 160); // tidied Name = username (shared names allowed)
    const duplicate = (w) => NextResponse.json({
      message: `This mobile number (${mobile}) is already registered with ${Number(w.contact_id) === contactId ? "this contact's" : "an existing"} worker "${w.name}"${w.worker_code ? ` (User ID ${w.worker_code})` : ""}. A duplicate Worker Link was not generated.`,
      duplicate: true,
      existing: { id: w.id, name: w.name, worker_code: w.worker_code, username: w.username, status: w.status, contact_id: w.contact_id || null, same_contact: Number(w.contact_id) === contactId },
    }, { status: 409, headers: NO_STORE });
    const findByMobile = async () => (await query(
      `SELECT id, name, worker_code, username, status, contact_id FROM reg_workers
        WHERE campaign_id = ? AND ${last10Sql("mobile")} = ? ORDER BY id ASC LIMIT 1`,
      [campaignId, mobile]
    ))[0] || null;

    const passwordHash = await bcrypt.hash(cred.password, 10);
    const outcome = await withNamedLock(`regw:${campaignId}:${mobile}`, async () => {
      const existing = await findByMobile();
      if (existing) return { duplicate: existing };
      try {
        const res = await query(
          `INSERT INTO reg_workers (campaign_id, contact_id, name, mobile, token, username, password_hash, password_set_at, created_by)
           VALUES (?,?,?,?,?,?,?,NOW(),?)`,
          [campaignId, contactId, name, mobile, newLinkToken(), name, passwordHash, null]
        );
        await query(`UPDATE reg_workers SET worker_code = ? WHERE id = ?`, [workerCodeFor(name, res.insertId), res.insertId]);
        return { workerId: res.insertId };
      } catch (err) {
        if (err?.code === "ER_DUP_ENTRY") return { duplicate: (await findByMobile()) || { name: "another worker" } };
        throw err;
      }
    });
    if (outcome.busy) return NextResponse.json({ message: "A link for this number is being generated right now. Please try again in a moment." }, { status: 409, headers: NO_STORE });
    if (outcome.value.duplicate) return duplicate(outcome.value.duplicate);
    const [row] = await query(`SELECT id, name, mobile, worker_code, username, status FROM reg_workers WHERE id = ?`, [outcome.value.workerId]);

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
