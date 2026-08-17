import { query } from "@/lib/db";
import { notWrongNumberClause } from "@/lib/contactExtras";

// District-wise ACTUAL people/worker count sourced from Contacts — the SINGLE
// source of truth shared by the Strength page, Area Ranking, Organization Map
// and the Workers-by-District tree map so they can never show different totals
// for the same district.
//
// CRITICAL: a contact's district is resolved EXACTLY the way the Contacts page
// resolves it (see buildContactPersonFilter in @/lib/contactFilter) — a person's
// geography lives on their linked WORKER row, so we key off the worker's
// district when the contact is linked to a worker, and fall back to the
// contact's own district_id only when it has no worker link:
//     effective_district = worker_id IS NOT NULL ? workers.district_id
//                                                : contacts.district_id
// Keying purely on contacts.district_id (the previous behaviour) under-counted
// any contact whose linked worker sits in a district its own column doesn't
// name — which is exactly why the Contacts page showed 1,342 for a district
// while Strength/Map/Ranking showed 1,336. Now every module matches Contacts.
//
// Wrong-number-flagged rows are excluded (same active-record rule as Contacts).
// Each contact is counted once (worker_id → workers.id is many-to-one, so the
// LEFT JOIN never fans a contact into multiple rows — no duplicate counting).
// No total is hardcoded and it auto-updates live as contacts change.
// Returns Map<district_id, count>.
export async function contactsByDistrict() {
  const notWrong = await notWrongNumberClause("ct");
  // The contact's effective (person-aware) district, identical to the Contacts
  // list filter. GROUP BY this so a worker-linked contact lands in its worker's
  // district and a link-less contact in its own.
  const effDistrict =
    "CASE WHEN ct.worker_id IS NOT NULL THEN w.district_id ELSE ct.district_id END";
  const rows = await query(
    `SELECT ${effDistrict} AS district_id, COUNT(*) AS n
       FROM contacts ct
       LEFT JOIN workers w ON w.id = ct.worker_id
      WHERE (${effDistrict}) IS NOT NULL${notWrong}
      GROUP BY district_id`
  );
  const m = new Map();
  for (const r of rows) m.set(r.district_id, Number(r.n) || 0);
  return m;
}

// Raw `users.role` values that count as actual field workers/callers — the same
// people Administration → Users manages. Oversight roles (super_admin / state /
// zone / district / assembly admin, supervisor) and media roles are excluded;
// contacts live in a separate table and are never counted.
export const WORKER_ROLES = ["caller", "worker", "user", "agent"];

// Resolve every ACTIVE worker/caller user to exactly one district and return a
// Map<district_id, count>. A user's district is taken from the first REAL
// signal that exists, in priority order:
//   1. users.home_district_id      — the district set in Administration → Users
//   2. workers.district_id          — via the workers row linked by workers.user_id
//   3. calls.district_id            — the district where they log the most calls
// No fabricated fallbacks; every count comes from an existing relation. Three
// grouped queries (no per-user fan-out) keep it efficient. Shared by the
// Strength ranking and the Leader Assessment assembly list so both agree.
export async function workersByDistrict() {
  const rolePlaceholders = WORKER_ROLES.map(() => "?").join(",");
  const users = await query(
    `SELECT id, home_district_id FROM users
      WHERE is_active = 1 AND role IN (${rolePlaceholders})`,
    WORKER_ROLES
  );
  if (users.length === 0) return new Map();

  const ids = users.map((u) => u.id);
  const idPlaceholders = ids.map(() => "?").join(",");

  // workers.user_id → a district (one per user; MIN is arbitrary-but-stable).
  const workerRows = await query(
    `SELECT user_id, MIN(district_id) AS district_id
       FROM workers
      WHERE user_id IN (${idPlaceholders}) AND district_id IS NOT NULL
      GROUP BY user_id`,
    ids
  );
  const workerDistrict = new Map(workerRows.map((r) => [r.user_id, r.district_id]));

  // calls.user_id → the district they called into most often.
  const callRows = await query(
    `SELECT user_id, district_id, COUNT(*) AS n
       FROM calls
      WHERE user_id IN (${idPlaceholders}) AND district_id IS NOT NULL
      GROUP BY user_id, district_id`,
    ids
  );
  const topCallDistrict = new Map();
  const bestN = new Map();
  for (const r of callRows) {
    if (!bestN.has(r.user_id) || r.n > bestN.get(r.user_id)) {
      bestN.set(r.user_id, r.n);
      topCallDistrict.set(r.user_id, r.district_id);
    }
  }

  const counts = new Map();
  for (const u of users) {
    const did = u.home_district_id ?? workerDistrict.get(u.id) ?? topCallDistrict.get(u.id) ?? null;
    if (did == null) continue;
    counts.set(did, (counts.get(did) || 0) + 1);
  }
  return counts;
}
