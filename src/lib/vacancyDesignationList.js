import { query } from "@/lib/db";
import { wingsMapFor } from "@/lib/designationWings";
import { ensureWingSchema } from "@/lib/wingDesignations";

// DESIGNATION VACANCIES — the FIXED designation list.
//
// Designation Vacancies (list, Tree Map, Wing views, responsible persons, WhatsApp messages) no longer reads the Designation
// Master live. It reads this frozen list instead: every designation that was part of Designation Vacancies when the list was
// first created, with the name, organisational Level, Wing(s), Wing base role and Rank it had then. Adding, editing, renaming,
// re-ranking, disabling or deleting a designation in Master Data changes NOTHING here — the Vacancies list stays exactly as it is.
//
// Holders are still matched LIVE by the designation's id (contact_designations), so assigning or removing a person updates the
// post's Filled / Vacant status at once; only WHICH posts exist, their names and their order are fixed.
//
// The list is captured ONCE (ledger `vacancy_designation_list_v1`), from the designations enabled in Master Data at that moment
// at the vacancy levels — i.e. exactly the posts Designation Vacancies showed until now. It is never rebuilt automatically.

export const VACANCY_LIST_LEVELS = ["state", "lok_sabha", "district", "assembly"];
const LEDGER = "vacancy_designation_list_v1";

let ready = null;   // Promise of the loaded list (process cache — the list never changes after it is captured)

async function capture() {
  // The Wing structure rules (Other Wings: fixed 2 / 3 / 3 / 3 designations) are applied first, so the captured list is
  // exactly what Designation Vacancies was showing.
  await ensureWingSchema();
  await query(`CREATE TABLE IF NOT EXISTS vacancy_designation_list (
    designation_id INT NOT NULL PRIMARY KEY,
    level VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    wing VARCHAR(120) NULL,
    wings TEXT NULL,
    base_name VARCHAR(120) NULL,
    position INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_vdl_level (level, position)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await query(`CREATE TABLE IF NOT EXISTS app_migrations (name VARCHAR(128) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  if ((await query("SELECT 1 FROM app_migrations WHERE name = ? LIMIT 1", [LEDGER])).length) return;

  const col = async (c) => (await query(`SHOW COLUMNS FROM designations LIKE '${c}'`)).length > 0;
  const [hasEnabled, hasRank, hasSort, hasWing, hasBase] = await Promise.all([col("enabled"), col("rank"), col("sort_order"), col("wing"), col("wing_base_id")]);
  const wbTable = hasBase && (await query("SHOW TABLES LIKE 'wing_designations'")).length > 0;
  const rows = await query(
    `SELECT d.id, d.name, d.level, ${hasWing ? "d.wing" : "NULL AS wing"}, ${wbTable ? "wd.base_name" : "NULL AS base_name"}
       FROM designations d ${wbTable ? "LEFT JOIN wing_designations wd ON wd.id = d.wing_base_id" : ""}
      WHERE d.level IN (${VACANCY_LIST_LEVELS.map(() => "?").join(",")}) ${hasEnabled ? "AND (d.enabled = 1 OR d.enabled IS NULL)" : ""}
      ORDER BY FIELD(d.level, ${VACANCY_LIST_LEVELS.map(() => "?").join(",")}),
               ${hasRank ? "(d.`rank` IS NULL), d.`rank`, " : ""}${hasSort ? "(d.sort_order IS NULL), d.sort_order, " : ""}d.name, d.id`,
    [...VACANCY_LIST_LEVELS, ...VACANCY_LIST_LEVELS]
  );
  const wmap = await wingsMapFor(rows);
  // Insert + ledger together; INSERT IGNORE keeps a concurrent first request from duplicating anything.
  let pos = 0;
  for (const r of rows) {
    pos += 1;
    // eslint-disable-next-line no-await-in-loop
    await query(
      "INSERT IGNORE INTO vacancy_designation_list (designation_id, level, name, wing, wings, base_name, position) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [r.id, r.level, r.name, r.wing || null, JSON.stringify(wmap.get(r.id) || []), r.base_name || null, pos]
    );
  }
  await query("INSERT IGNORE INTO app_migrations (name) VALUES (?)", [LEDGER]);
}

async function load() {
  await capture();
  const rows = await query("SELECT designation_id, level, name, wing, wings, base_name, position FROM vacancy_designation_list ORDER BY position");
  const list = rows.map((r) => {
    let wings = [];
    try { wings = JSON.parse(r.wings || "[]"); } catch { wings = []; }
    return { id: Number(r.designation_id), level: r.level, name: r.name, wing: r.wing || null, wings: Array.isArray(wings) ? wings : [], base_name: r.base_name || null, position: Number(r.position) };
  });
  return { list, byId: new Map(list.map((d) => [d.id, d])) };
}

// The whole fixed list (cached for the life of the process; it never changes once captured).
export async function vacancyDesignationList() {
  if (!ready) ready = load().catch((e) => { ready = null; throw e; });
  return ready;
}

// The fixed designations of one level, in their fixed order: [{ id, name, wing, wings, base_name, position }].
export async function fixedLevelDesignations(level) {
  const { list } = await vacancyDesignationList();
  return list.filter((d) => d.level === level);
}

// id → fixed name / fixed order position (for messages, labels and sorting).
export async function fixedDesignationNames() {
  const { byId } = await vacancyDesignationList();
  return new Map([...byId.values()].map((d) => [d.id, d.name]));
}
export async function fixedDesignationOrder() {
  const { byId } = await vacancyDesignationList();
  return new Map([...byId.values()].map((d) => [d.id, d.position]));
}
