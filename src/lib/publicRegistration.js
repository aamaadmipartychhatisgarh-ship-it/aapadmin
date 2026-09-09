import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  ensureRegistrationSchema, normalizeMobile, newLinkToken, workerCodeFor, regNow, PERSON_TYPES,
} from "@/lib/registrationSchema";

// The ONLY unauthenticated surface of the Voter & Worker Registration module.
// Both public routes are thin wrappers over the two handlers at the bottom of
// this file, so the open link and any token link behave identically.
//
// A request resolves to a collector in one of three ways:
//   • NO token (/join)      → the one standing link. It resolves to the drive
//                             that is currently active, and the karyakarta
//                             identifies themselves with their own mobile
//                             number. Nothing to issue, nothing to expire.
//   • a DRIVE token         → the same thing, but pinned to one specific drive
//                             (useful once several drives run at once).
//   • a WORKER token        → a personal link for a named karyakarta; they type
//                             nothing to identify themselves.
// In every case the worker_id written on a registration is decided server-side
// from the link plus the mobile number — never from a name a submitter typed.
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

const CAMPAIGN_COLS = `id AS campaign_id, name AS campaign_name, election_type, constituency,
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
            c.id AS campaign_id, c.name AS campaign_name, c.election_type, c.constituency,
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

// On a drive link the collector is identified by their own mobile number: the
// same number always resolves to the same worker row, so a karyakarta's total
// keeps accumulating no matter which phone or browser session they use. On a
// worker link the row is already known and this is never called.
async function findOrCreateWorker(campaignId, { name, mobile, ward, areaBooth }) {
  const [existing] = await query(
    `SELECT id, name, mobile, worker_code, status FROM reg_workers WHERE campaign_id = ? AND mobile = ? LIMIT 1`,
    [campaignId, mobile]
  );
  if (existing) {
    if (existing.status !== "active") return { blocked: true };
    // Fill in details the row is still missing; never overwrite a name an admin
    // already set.
    await query(
      `UPDATE reg_workers
          SET name = COALESCE(NULLIF(name, ''), ?),
              ward_number = COALESCE(ward_number, ?),
              area_booth = COALESCE(area_booth, ?)
        WHERE id = ?`,
      [name || existing.name, ward, areaBooth, existing.id]
    );
    return { worker: existing };
  }
  const res = await query(
    `INSERT INTO reg_workers (campaign_id, name, mobile, token, ward_number, area_booth)
     VALUES (?,?,?,?,?,?)`,
    [campaignId, name, mobile, newLinkToken(), ward, areaBooth]
  );
  await query(`UPDATE reg_workers SET worker_code = ? WHERE id = ?`, [workerCodeFor(name, res.insertId), res.insertId]);
  const [row] = await query(`SELECT id, name, mobile, worker_code, status FROM reg_workers WHERE id = ?`, [res.insertId]);
  return { worker: row, created: true };
}

// A worker's own running total — the only aggregate this public surface exposes,
// and only about the worker holding the session.
async function tallyFor(workerId) {
  const [t] = await query(
    `SELECT COUNT(*) AS total,
            SUM(person_type = 'voter') AS voters,
            SUM(person_type = 'worker') AS new_workers
       FROM reg_people WHERE worker_id = ? AND status = 'active'`,
    [workerId]
  );
  return { total: Number(t?.total || 0), voters: Number(t?.voters || 0), new_workers: Number(t?.new_workers || 0) };
}

// GET — the form's bootstrap: the election header to display, and on a personal
// link the worker's saved details to prefill. Returns no other person's data.
export async function publicFormContext(token) {
  try {
    await ensureRegistrationSchema();
    const link = await resolveLink(token);
    if (!link) {
      return NextResponse.json({ message: token ? INVALID_LINK : NO_OPEN_DRIVE }, { status: 404, headers: NO_STORE });
    }
    // A personal link shows that worker their running total — a small motivator
    // in the field. On the open link there is no worker until the first submit.
    const tally = link.worker_id ? await tallyFor(link.worker_id) : { total: 0, voters: 0, new_workers: 0 };
    return NextResponse.json(
      {
        mode: link.mode,
        campaign: {
          name: link.campaign_name,
          election_type: link.election_type,
          constituency: link.constituency,
          ward_number: link.campaign_ward,
          election_year: link.election_year,
        },
        worker: link.mode === "worker"
          ? {
              name: link.worker_name, mobile: link.worker_mobile, worker_code: link.worker_code,
              ward_number: link.worker_ward, area_booth: link.worker_area,
            }
          : null,
        tally,
      },
      { headers: NO_STORE }
    );
  } catch (e) {
    console.error("[registration] public GET error:", e);
    return NextResponse.json({ message: "Could not open this form. Please try again." }, { status: 500, headers: NO_STORE });
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
    const ward = clip(d.ward_number, 60) || link.worker_ward || link.campaign_ward || null;
    const areaBooth = clip(d.area_booth, 160) || link.worker_area || null;
    const address = String(d.address || "").trim().slice(0, 2000) || null;

    // Resolve WHO is collecting. A personal link already knows; the open link
    // identifies the karyakarta by the mobile number they enter, which is what
    // lets one standing link serve everyone with no pre-registration.
    let workerId = link.worker_id;
    if (link.mode === "drive") {
      const collectorName = clip(d.worker_name, 160);
      const collectorMobile = normalizeMobile(d.worker_mobile);
      if (!collectorName) {
        return NextResponse.json({ message: "Please enter your own name (the worker filling this form)." }, { status: 400, headers: NO_STORE });
      }
      if (!collectorMobile) {
        return NextResponse.json({ message: "Please enter your own valid 10-digit mobile number." }, { status: 400, headers: NO_STORE });
      }
      // The two mobile numbers matching is SELF-REGISTRATION, not an error: the
      // open link goes to ordinary voters too, and many will simply fill in their
      // own details. They are credited to themselves, which is the truthful
      // record of who brought them in.
      const found = await findOrCreateWorker(link.campaign_id, { name: collectorName, mobile: collectorMobile, ward, areaBooth });
      if (found.blocked) {
        return NextResponse.json({ message: "This worker account has been disabled. Please contact your in-charge." }, { status: 403, headers: NO_STORE });
      }
      workerId = found.worker.id;
    }

    // One mobile number is one person per drive. A repeat is reported plainly
    // (with who first registered them) instead of silently creating a duplicate
    // that would inflate a worker's ranking.
    const [dupe] = await query(
      `SELECT p.id, w.name AS worker_name
         FROM reg_people p JOIN reg_workers w ON w.id = p.worker_id
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
         (campaign_id, worker_id, person_type, name, mobile, address, ward_number, area_booth,
          wants_worker, worker_role, status, source_ip, registered_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'active', ?, ?)`,
      [link.campaign_id, workerId, personType, name.slice(0, 160), mobile, address,
       ward, areaBooth, wantsWorker, workerRole, ip, regNow()]
    );

    // On a personal link the karyakarta may complete details the admin left
    // blank, but never overwrite an identity an admin already set.
    if (link.mode === "worker") {
      const wName = clip(d.worker_name, 160);
      const wMobile = normalizeMobile(d.worker_mobile);
      if ((wName && !link.worker_name) || (wMobile && !link.worker_mobile)) {
        await query(
          `UPDATE reg_workers
              SET name = COALESCE(NULLIF(name, ''), ?), mobile = COALESCE(NULLIF(mobile, ''), ?)
            WHERE id = ?`,
          [wName || link.worker_name, wMobile || link.worker_mobile, workerId]
        );
      }
    }

    return NextResponse.json({ ok: true, tally: await tallyFor(workerId) }, { status: 201, headers: NO_STORE });
  } catch (e) {
    console.error("[registration] public POST error:", e);
    return NextResponse.json({ message: "Could not save this registration. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
