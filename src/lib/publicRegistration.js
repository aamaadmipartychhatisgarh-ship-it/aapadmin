import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  ensureRegistrationSchema, normalizeMobile, normalizeWard, regNow, PERSON_TYPES,
} from "@/lib/registrationSchema";

// The ONLY unauthenticated surface of the Voter & Worker Registration module.
// Both public routes are thin wrappers over the two handlers at the bottom of
// this file, so every link kind behaves identically.
//
// WHO GETS THE CREDIT IS DECIDED ENTIRELY BY THE LINK. The form never asks, and
// there is no field a submitter could use to claim someone else's work:
//   • NO token (/join)  → the general public link, resolving to whichever drive
//                         is active. The registration belongs to the drive and
//                         to no karyakarta (worker_id stays NULL).
//   • a DRIVE token     → the same, pinned to one specific drive.
//   • a WORKER token    → a link generated for one karyakarta and shared by
//                         them; every registration through it is theirs.
// Nothing else about the organisation is readable through these endpoints.
export const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };

const INVALID_LINK = "This registration link is not valid or has been closed. Please contact your in-charge.";
const NO_OPEN_DRIVE = "Registration is not open right now. Please contact your in-charge.";

// --- Abuse control ---------------------------------------------------------
// A public form needs a floor under it. Two cheap, dependency-free measures:
//   • a per-IP sliding window, so one source cannot flood the drive;
//   • a honeypot field the real form keeps hidden and empty — bots fill it.
// Both fail CLOSED for the submitter (with a clear message) and never lose data
// for a genuine user. The window map is per-process and self-pruning.
const RATE_LIMIT = { max: 40, windowMs: 10 * 60 * 1000 };
const hits = new Map();

function rateLimited(key) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT.windowMs;
  const recent = (hits.get(key) || []).filter((t) => t > cutoff);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => t > cutoff)) hits.delete(k);
  }
  return recent.length > RATE_LIMIT.max;
}

function clientIp(req) {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return (fwd.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim().slice(0, 64);
}

const CAMPAIGN_COLS = `id AS campaign_id, name AS campaign_name, election_type, constituency, constituency_id,
                       ward_number AS campaign_ward, election_year, status AS campaign_status`;

// Resolve the request to { campaign, worker? }. Returns null for an unknown
// token, a disabled worker or a closed drive; the caller reports all of those
// the same way, so probing teaches nothing about which tokens exist.
async function resolveLink(token) {
  const t = String(token || "").trim();

  // No token → the standing /join link: whichever drive is currently active.
  // Newest wins if more than one is somehow left open, so reopening a drive is
  // enough to redirect the link without touching anything that was shared.
  if (!t) {
    const [c] = await query(
      `SELECT ${CAMPAIGN_COLS} FROM reg_campaigns WHERE status = 'active' ORDER BY created_at DESC, id DESC LIMIT 1`
    );
    return c ? { ...c, mode: "drive", worker_id: null } : null;
  }
  if (t.length > 64) return null;

  // A worker link first — the more specific of the two token kinds.
  const [w] = await query(
    `SELECT w.id AS worker_id, w.name AS worker_name, w.mobile AS worker_mobile,
            w.worker_code, w.ward_number AS worker_ward, w.area_booth AS worker_area, w.status AS worker_status,
            c.id AS campaign_id, c.name AS campaign_name, c.election_type, c.constituency, c.constituency_id,
            c.ward_number AS campaign_ward, c.election_year, c.status AS campaign_status
       FROM reg_workers w
       JOIN reg_campaigns c ON c.id = w.campaign_id
      WHERE w.token = ? LIMIT 1`,
    [t]
  );
  if (w) {
    if (w.worker_status !== "active" || w.campaign_status !== "active") return null;
    return { ...w, mode: "worker" };
  }

  const [c] = await query(`SELECT ${CAMPAIGN_COLS} FROM reg_campaigns WHERE public_token = ? LIMIT 1`, [t]);
  if (!c || c.campaign_status !== "active") return null;
  return { ...c, mode: "drive", worker_id: null };
}

// GET — the form's bootstrap. It returns the ELECTION HEADER AND NOTHING ELSE.
//
// A karyakarta's link is shared with the public, so anyone holding it can call
// this endpoint. It therefore exposes no worker name, no worker code, no tallies
// and no other person's data — only what the form has to print at the top. The
// ward/booth defaults ride along because they are properties of the drive that
// the form fills in for the person anyway.
export async function publicFormContext(token) {
  try {
    await ensureRegistrationSchema();
    const link = await resolveLink(token);
    if (!link) {
      return NextResponse.json({ message: token ? INVALID_LINK : NO_OPEN_DRIVE }, { status: 404, headers: NO_STORE });
    }
    // The constituency list people choose from. Constituency names are public
    // information (they are on every ballot), so serving them here exposes
    // nothing — and choosing from the master list is what keeps the data
    // clean enough to group by, which free text never is.
    const constituencies = await query(
      `SELECT id, name FROM locations WHERE type = 'assembly' ORDER BY name ASC`
    );

    return NextResponse.json(
      {
        campaign: { name: link.campaign_name, election_year: link.election_year },
        constituencies,
        // On a karyakarta's link, the NAME of the person the entry is credited
        // to — reassuring for the voter, who was sent the link by that
        // karyakarta and already knows them. Deliberately just the name: the
        // internal worker code and their running totals are organisation data
        // and have no business on a page shared with the public.
        credited_to: link.mode === "worker" ? link.worker_name : null,
        // Editable defaults. On a karyakarta's link the ward/booth come from
        // their own patch, which beats the drive's — but they reveal nothing
        // about whose link it is.
        defaults: {
          assembly_id: link.constituency_id || null,
          ward_number: normalizeWard(link.worker_ward || link.campaign_ward),
          area_booth: link.worker_area || null,
        },
      },
      { headers: NO_STORE }
    );
  } catch (e) {
    console.error("[registration] public GET error:", e);
    return NextResponse.json({ message: "Could not open this form. Please try again." }, { status: 500, headers: NO_STORE });
  }
}

// GET ?list=voter|worker — the "मेरे वोटर / मेरे कार्यकर्ता" list for the link the
// caller holds. OWNERSHIP IS DERIVED FROM THE LINK, never from the client: a
// worker link scopes to that worker's OWN registrations; the general /join or a
// drive link scopes to the drive's direct (unattributed) registrations. So one
// karyakarta's link can never surface another's people, and there is no id a
// request could tamper with to widen the scope (§21–§23).
export async function publicOwnList(token, type) {
  try {
    await ensureRegistrationSchema();
    const link = await resolveLink(token);
    if (!link) {
      return NextResponse.json({ message: token ? INVALID_LINK : NO_OPEN_DRIVE }, { status: 404, headers: NO_STORE });
    }
    const personType = type === "worker" ? "worker" : "voter";
    const where = ["p.campaign_id = ?", "p.status = 'active'", "p.person_type = ?"];
    const params = [link.campaign_id, personType];
    if (link.mode === "worker") { where.push("p.worker_id = ?"); params.push(link.worker_id); }
    else { where.push("p.worker_id IS NULL"); }

    const rows = await query(
      `SELECT p.id, p.name, p.mobile, p.photo_url, p.address, p.assembly_name,
              p.ward_number, p.ward_name, p.area_booth, p.registered_at
         FROM reg_people p
        WHERE ${where.join(" AND ")}
        ORDER BY p.registered_at DESC, p.id DESC
        LIMIT 500`,
      params
    );
    return NextResponse.json(
      { people: rows, total: rows.length, type: personType, credited_to: link.mode === "worker" ? link.worker_name : null },
      { headers: NO_STORE }
    );
  } catch (e) {
    console.error("[registration] public list error:", e);
    return NextResponse.json({ message: "Could not load the list. Please try again." }, { status: 500, headers: NO_STORE });
  }
}

// POST — record one person. The registration timestamp is set server-side in IST
// (see regNow), never supplied by the client.
export async function submitPublicRegistration(req, token) {
  try {
    await ensureRegistrationSchema();
    const link = await resolveLink(token);
    if (!link) {
      return NextResponse.json({ message: token ? INVALID_LINK : NO_OPEN_DRIVE }, { status: 404, headers: NO_STORE });
    }

    const ip = clientIp(req);
    if (rateLimited(`${ip}:${link.worker_id || link.campaign_id}`)) {
      return NextResponse.json(
        { message: "Too many entries from this device just now. Please wait a few minutes and try again." },
        { status: 429, headers: NO_STORE }
      );
    }

    const d = await req.json().catch(() => null);
    if (!d || typeof d !== "object") {
      return NextResponse.json({ message: "Invalid request." }, { status: 400, headers: NO_STORE });
    }
    // Honeypot — the real form renders this hidden and leaves it empty.
    if (String(d.website || "").trim()) {
      return NextResponse.json({ message: "Submission rejected." }, { status: 400, headers: NO_STORE });
    }

    const name = String(d.name || "").trim();
    if (!name) return NextResponse.json({ message: "Please enter the person's name." }, { status: 400, headers: NO_STORE });
    if (name.length > 160) return NextResponse.json({ message: "Name is too long." }, { status: 400, headers: NO_STORE });

    const mobile = normalizeMobile(d.mobile);
    if (!mobile) {
      return NextResponse.json({ message: "Please enter a valid 10-digit mobile number." }, { status: 400, headers: NO_STORE });
    }

    const personType = PERSON_TYPES.includes(d.person_type) ? d.person_type : "voter";
    // "Wants to become a worker" is the person type itself; the explicit Yes/No
    // and the role are only meaningful on that branch.
    const wantsWorker = personType === "worker" ? 1 : 0;
    const workerRole = wantsWorker ? (String(d.worker_role || "").trim().slice(0, 160) || null) : null;

    const clip = (v, n) => { const s = String(v ?? "").trim(); return s ? s.slice(0, n) : null; };
    const ward = normalizeWard(d.ward_number) || normalizeWard(link.worker_ward || link.campaign_ward);
    const areaBooth = clip(d.area_booth, 160) || link.worker_area || null;
    const wardName = clip(d.ward_name, 160);
    const address = String(d.address || "").trim().slice(0, 2000) || null;

    // Photo (Worker Form): accept ONLY a path produced by our own upload endpoint
    // (/uploads/<id>.<ext>) — never an arbitrary client-supplied URL — so the row
    // can only reference an image actually stored in our photo store.
    const rawPhoto = String(d.photo_url || "").trim();
    const photoUrl = /^\/uploads\/[A-Za-z0-9._-]+$/.test(rawPhoto) ? rawPhoto.slice(0, 512) : null;

    // The constituency must be one from the master list. Resolving the id here
    // rather than trusting a submitted name is what keeps the ward and
    // constituency reports groupable — a free-text field would fill them with
    // spelling variants of the same place.
    let assemblyId = null;
    let assemblyName = null;
    const pickedId = /^\d+$/.test(String(d.assembly_id || "")) ? Number(d.assembly_id) : null;
    if (pickedId) {
      const [loc] = await query(`SELECT id, name FROM locations WHERE id = ? AND type = 'assembly' LIMIT 1`, [pickedId]);
      if (loc) { assemblyId = loc.id; assemblyName = loc.name; }
    }
    if (!assemblyId) {
      return NextResponse.json({ message: "Please select your constituency." }, { status: 400, headers: NO_STORE });
    }

    // WHO gets the credit comes from the link, full stop. A generated worker
    // link carries their id; the general link carries none, and the row is
    // recorded against the drive alone.
    const workerId = link.worker_id ?? null;

    // One mobile number is one person per drive. A repeat is reported plainly
    // (with who first registered them) instead of silently creating a duplicate
    // that would inflate a worker's ranking.
    const [dupe] = await query(
      `SELECT p.id, w.name AS worker_name
         FROM reg_people p LEFT JOIN reg_workers w ON w.id = p.worker_id
        WHERE p.campaign_id = ? AND p.mobile = ? AND p.status = 'active' LIMIT 1`,
      [link.campaign_id, mobile]
    );
    if (dupe) {
      return NextResponse.json(
        { message: `This mobile number is already registered${dupe.worker_name ? ` (added by ${dupe.worker_name})` : ""}.`, duplicate: true },
        { status: 409, headers: NO_STORE }
      );
    }

    await query(
      `INSERT INTO reg_people
         (campaign_id, worker_id, person_type, name, mobile, address, assembly_id, assembly_name,
          ward_number, ward_name, area_booth, wants_worker, worker_role, photo_url, status, source_ip, registered_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'active', ?, ?)`,
      [link.campaign_id, workerId, personType, name.slice(0, 160), mobile, address,
       assemblyId, assemblyName, ward, wardName, areaBooth, wantsWorker, workerRole, photoUrl, ip, regNow()]
    );

    // Just an acknowledgement — no counts, for the same reason the bootstrap
    // returns none: whoever is holding this link is a member of the public.
    return NextResponse.json({ ok: true }, { status: 201, headers: NO_STORE });
  } catch (e) {
    console.error("[registration] public POST error:", e);
    return NextResponse.json({ message: "Could not save this registration. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
