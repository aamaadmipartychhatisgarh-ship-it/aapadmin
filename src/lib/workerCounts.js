import { query } from "@/lib/db";
import { notWrongNumberClause, notPendingClause, notNotInterestedClause } from "@/lib/contactExtras";
import { repeatOffExclusion } from "@/lib/repeatOff";

// The ACTIVE-record rule shared by every district / assembly worker figure, identical to the Contacts list's default view: not a
// Wrong Number, not Not Interested, not 10+ times Switched Off / Incoming Off, and not awaiting Supervisor approval. (The count used to
// leave out the Not Interested and 10+ Off rules, so a district showed more "workers" than its Contacts list held.)
async function activeContactClause(alias = "ct") {
  return (await notWrongNumberClause(alias)) + (await notNotInterestedClause(alias)) + (await repeatOffExclusion(alias)) + (await notPendingClause(alias));
}

// ONE PERSON, ONE COUNT. A phone number saved twice in different formats ("09333333333" and "+91 93333 33333") is two contact rows
// for one person. Contacts are therefore counted per PERSON: the rows of an active person are collapsed to the lowest contact id, by the
// number's last 10 digits (rows with no number are each their own person). Because exactly one row per person is kept BEFORE it is placed
// in a district / assembly, the district (or assembly) figures can never double count, and sum + unmapped = the overall unique total.
const PHONE_KEY = (a) => `RIGHT(REGEXP_REPLACE(IFNULL(${a}.phone_number,''), '[^0-9]', ''), 10)`;
async function uniquePersonJoin(alias = "ct") {
  const act = await activeContactClause("c2");
  return `JOIN (SELECT MIN(c2.id) AS keep_id FROM contacts c2 WHERE 1 = 1${act}
                  GROUP BY IF(${PHONE_KEY("c2")} = '', CONCAT('id', c2.id), ${PHONE_KEY("c2")})) up ON up.keep_id = ${alias}.id`;
}
// Active contact rows that are repeats of another row of the same person (not counted anywhere).
export async function duplicateContactRows() {
  const act = await activeContactClause("ct");
  const uq = await uniquePersonJoin("ct");
  const [r] = await query(`SELECT (SELECT COUNT(*) FROM contacts ct WHERE 1 = 1${act}) - (SELECT COUNT(*) FROM contacts ct ${uq} WHERE 1 = 1${act}) AS d`);
  return Math.max(0, Number(r?.d) || 0);
}

// A contact's District is resolved to ONE valid district (a `locations` row of type 'district'), in this order:
//   1. the district of the linked WORKER (workers.district_id) - a person's geography lives on their worker row - when that worker row
//      exists AND names a real district;
//   2. the contact's own district_id, when it names a real district;
//   3. the district ABOVE the contact's Assembly (assembly -> district in the location hierarchy), for a contact that only has an Assembly.
// A value that is empty or points at a missing / non-district location is skipped (never counted under a wrong district), so such a
// contact is reported separately as "unmapped" (see workerDistrictReconciliation). Every join below is many-to-one (a contact has at
// most one worker, one district, one assembly; ids are unique), so a contact is never fanned out into several rows.
const DISTRICT_JOINS = `
       LEFT JOIN workers w ON w.id = ct.worker_id
       LEFT JOIN locations wd ON wd.id = w.district_id AND wd.type = 'district'
       LEFT JOIN locations cd ON cd.id = ct.district_id AND cd.type = 'district'
       LEFT JOIN locations ca ON ca.id = ct.assembly_id AND ca.type = 'assembly'
       LEFT JOIN locations ad ON ad.id = ca.parent_id AND ad.type = 'district'`;
const EFF_DISTRICT = "COALESCE(wd.id, cd.id, ad.id)";

// District-wise ACTUAL worker count sourced from Contacts - the SINGLE source of truth shared by the Strength page, Area Ranking,
// Organization Map and the Workers-by-District tree map so they can never show different totals for the same district.
// Each contact is counted once, in the district resolved above. No total is hardcoded; it updates live as contacts / workers change.
// Returns Map<district_id, count>.
export async function contactsByDistrict() {
  const active = await activeContactClause("ct");
  const uq = await uniquePersonJoin("ct");
  const rows = await query(
    `SELECT ${EFF_DISTRICT} AS district_id, COUNT(DISTINCT ct.id) AS n
       FROM contacts ct ${uq} ${DISTRICT_JOINS}
      WHERE ${EFF_DISTRICT} IS NOT NULL${active}
      GROUP BY district_id`
  );
  const m = new Map();
  for (const r of rows) m.set(r.district_id, Number(r.n) || 0);
  return m;
}

// Reconciliation of the district figures with the overall unique worker count: total = mapped to a district + not mapped. A contact
// with no district / assembly at all ("no_district"), or whose district / assembly values do not resolve to a real district
// ("invalid_district"), is NOT counted under any district - it is shown here so the numbers add up without being forced to.
export async function workerDistrictReconciliation() {
  const active = await activeContactClause("ct");
  const uq = await uniquePersonJoin("ct");
  const duplicates = await duplicateContactRows();
  const [r] = await query(
    `SELECT COUNT(DISTINCT ct.id) AS total,
            COUNT(DISTINCT CASE WHEN ${EFF_DISTRICT} IS NOT NULL THEN ct.id END) AS mapped,
            COUNT(DISTINCT CASE WHEN ${EFF_DISTRICT} IS NULL AND (ct.district_id IS NOT NULL OR ct.assembly_id IS NOT NULL OR w.district_id IS NOT NULL) THEN ct.id END) AS invalid_district
       FROM contacts ct ${uq} ${DISTRICT_JOINS}
      WHERE 1 = 1${active}`
  );
  const total = Number(r?.total) || 0, mapped = Number(r?.mapped) || 0, invalid = Number(r?.invalid_district) || 0;
  return { total, mapped, invalid_district: invalid, no_district: total - mapped - invalid, unmapped: total - mapped, duplicates_excluded: duplicates };
}

// A contact's ASSEMBLY, resolved exactly the way the Contact List's Assembly filter resolves it (buildContactPersonFilter): a contact linked
// to a WORKER belongs to that worker's assembly (workers.assembly_id - the person's geography lives on the worker row), any other
// contact to its own assembly_id. The value must name a real assembly (a `locations` row of type 'assembly'): an empty value, or one that
// points at a missing / non-assembly location, maps to NO assembly and is reported separately (workerAssemblyReconciliation) instead of
// being counted anywhere. Nothing is derived from calls, callers, assignments, designations or wings. All joins are many-to-one (one
// worker per contact, one location per id) and the count is over DISTINCT contact ids, so a contact is never counted twice.
const ASSEMBLY_JOINS = `
       LEFT JOIN workers w ON w.id = ct.worker_id
       LEFT JOIN locations wa ON wa.id = w.assembly_id AND wa.type = 'assembly'
       LEFT JOIN locations ca ON ca.id = ct.assembly_id AND ca.type = 'assembly'`;
const EFF_ASSEMBLY = "CASE WHEN ct.worker_id IS NOT NULL THEN wa.id ELSE ca.id END";
const RAW_ASSEMBLY = "CASE WHEN ct.worker_id IS NOT NULL THEN w.assembly_id ELSE ct.assembly_id END";

// Assembly-wise ACTUAL worker count from Contacts - the assembly analogue of contactsByDistrict, using the SAME active-record rule (the
// Contact List's default view), so the two always reconcile and the figure equals the Contact List filtered to that Assembly.
// Returns Map<assembly_id, count>. No total is hardcoded; it updates live as contacts / workers change.
export async function contactsByAssembly() {
  const active = await activeContactClause("ct");
  const uq = await uniquePersonJoin("ct");
  const rows = await query(
    `SELECT ${EFF_ASSEMBLY} AS assembly_id, COUNT(DISTINCT ct.id) AS n
       FROM contacts ct ${uq} ${ASSEMBLY_JOINS}
      WHERE (${EFF_ASSEMBLY}) IS NOT NULL${active}
      GROUP BY assembly_id`
  );
  const m = new Map();
  for (const r of rows) m.set(r.assembly_id, Number(r.n) || 0);
  return m;
}

// Overall unique worker count vs the assembly figures: total = mapped to an assembly + not mapped. "no_assembly" = nothing recorded for
// the contact's assembly (or a worker link whose worker row has none); "invalid_assembly" = a value that is not a real assembly.
export async function workerAssemblyReconciliation() {
  const active = await activeContactClause("ct");
  const uq = await uniquePersonJoin("ct");
  const duplicates = await duplicateContactRows();
  const [r] = await query(
    `SELECT COUNT(DISTINCT ct.id) AS total,
            COUNT(DISTINCT CASE WHEN ${EFF_ASSEMBLY} IS NOT NULL THEN ct.id END) AS mapped,
            COUNT(DISTINCT CASE WHEN ${EFF_ASSEMBLY} IS NULL AND ${RAW_ASSEMBLY} IS NOT NULL THEN ct.id END) AS invalid_assembly
       FROM contacts ct ${uq} ${ASSEMBLY_JOINS}
      WHERE 1 = 1${active}`
  );
  const total = Number(r?.total) || 0, mapped = Number(r?.mapped) || 0, invalid = Number(r?.invalid_assembly) || 0;
  return { total, mapped, invalid_assembly: invalid, no_assembly: total - mapped - invalid, unmapped: total - mapped, duplicates_excluded: duplicates };
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
