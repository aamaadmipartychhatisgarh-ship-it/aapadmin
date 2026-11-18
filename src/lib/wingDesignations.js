import { query } from "@/lib/db";
import { ensureDesignationLevelColumn } from "@/lib/designationLevels";
import { OTHER_WINGS, otherWingOf, owAllowed, owRoleOfBase, OW_ROLES } from "@/lib/otherWingStructure";
import { wingsMapFor } from "@/lib/designationWings";

// WING-WISE DESIGNATION MASTER + AUTO GENERATION.
//
// A Wing (Main Organisation, or one of the state wings) has an ordered list of
// BASE roles (President, General Secretary, …). From that single master the system
// AUTO-GENERATES the level-specific designations across State → Lok Sabha →
// District → Assembly by applying the level prefix and ", <Wing>" suffix, in the
// SAME order. The generated designations are materialised into the existing
// `designations` table (tagged with wing + base id + enabled), so organizational
// assignment, the vacancy/incomplete tracker and reports all keep reading ONE
// source of truth — nothing is hardcoded or duplicated.
//
//   wings              — the Wing master (Main Organisation + the 10 wings, seeded)
//   wing_designations  — each wing's ordered base roles (admin-configurable)
//   designations       — gains `wing`, `wing_base_id`, `enabled` (generated rows)

// The organizational levels designations generate across, in order:
// State → Lok Sabha → District → Assembly → Block (block = the `ward` location type).
export const WING_LEVELS = [
  { key: "state", label: "State" },
  { key: "lok_sabha", label: "Lok Sabha" },
  { key: "district", label: "District" },
  { key: "assembly", label: "Assembly" },
  { key: "block", label: "Block" },
];
const LEVEL_LABEL = Object.fromEntries(WING_LEVELS.map((l) => [l.key, l.label]));

// The seeded wings. Main Organisation is special (fixed State designations, no
// level generation); the rest are level-generated from their own base roles.
// Seeding is additive (INSERT IGNORE) — existing wings on a live install are never
// removed or renamed, so no configured order or assignment is lost.
export const MAIN_WING = "Main Organisation";
const SEED_WINGS = [
  "SC Wing", "ST Wing", "Youth Wing", "Mahila Wing", "RTI Wing", "Legal Wing",
  "Transport Wing", "RWA Wing", "OBC Wing", "Social Media Wing", "Ex-Employee Wing",
  "ASAP Wing", "Minority Wing", "Labour Wing", "Trade Wing",
];
// The Main State Administration designations, in EXACTLY this sequence (§1).
const MAIN_STATE_DESIGNATIONS = [
  "State Prabhari", "State Seh Prabhari", "State President", "State Working President",
  "State General Secretary", "State General Secretary Organisation", "State General Secretary Media",
  "State Vice President", "State Secretary", "State Joint Secretary",
  "State Chief Spokesperson", "State Spokesperson", "State Treasurer", "State Vice Treasurer",
];

// The generated designation name for a base role at a level of a wing.
export function generatedName(levelKey, baseName, wingName) {
  return `${LEVEL_LABEL[levelKey]} ${baseName}, ${wingName}`;
}

let ensured = false;
// M1 — if any step before `ensured = true` throws (a transient lock / statement
// timeout on wings/designations), `ensured` stays false and WITHOUT this throttle
// every subsequent GET /api/designations would re-run the whole heavy path
// (column probes, 2× CREATE TABLE, 16× INSERT IGNORE seed, 14 upserts) and re-wait
// on the same timing-out DB. A failed attempt parks retries for a short cooldown;
// once a full run succeeds, `ensured` latches true for the process lifetime.
let lastEnsureFailAt = 0;
const ENSURE_RETRY_COOLDOWN_MS = 15000;
export async function ensureWingSchema() {
  if (ensured) return;
  if (lastEnsureFailAt && Date.now() - lastEnsureFailAt < ENSURE_RETRY_COOLDOWN_MS) return;
  try {
    await ensureDesignationLevelColumn(query);
    await query(
      `CREATE TABLE IF NOT EXISTS wings (
         id INT AUTO_INCREMENT PRIMARY KEY,
         name VARCHAR(120) NOT NULL,
         sort_order INT NOT NULL DEFAULT 0,
         is_main TINYINT NOT NULL DEFAULT 0,
         enabled TINYINT NOT NULL DEFAULT 1,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE KEY uq_wing_name (name)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    await query(
      `CREATE TABLE IF NOT EXISTS wing_designations (
         id INT AUTO_INCREMENT PRIMARY KEY,
         wing_id INT NOT NULL,
         base_name VARCHAR(160) NOT NULL,
         sort_order INT NOT NULL DEFAULT 0,
         enabled TINYINT NOT NULL DEFAULT 1,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uq_wing_base (wing_id, base_name),
         KEY idx_wing (wing_id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    // Tag the shared designations table so generated rows are traceable and the
    // enabled flag can hide a disabled designation without deleting it/its assignments.
    await ensureDesignationColumn("wing", "VARCHAR(120) NULL");
    await ensureDesignationColumn("wing_base_id", "INT NULL");
    await ensureDesignationColumn("enabled", "TINYINT NOT NULL DEFAULT 1");
    // manual_order marks a (level, wing) bucket whose designation order was set by
    // hand in the Designation Order panel. When set, the auto-generator below
    // (syncWing) NEVER overwrites that row's sort_order — the admin's manual order
    // is the single source of truth and survives later wing/base edits.
    await ensureDesignationColumn("manual_order", "TINYINT NOT NULL DEFAULT 0");
    if (!(await query("SHOW COLUMNS FROM designations LIKE 'sort_order'")).length) {
      await ensureDesignationColumn("sort_order", "INT NULL");
    }
    // `rank` is the GLOBAL, single-source designation order (1,2,3… across the whole
    // master). It is the PRIMARY ordering key everywhere designations are shown; the
    // older per-group sort_order remains only as a tie-breaker fallback. `rank` is a
    // reserved word, so it is always back-quoted in SQL.
    await ensureDesignationColumn("rank", "INT NULL");

    // The one-time-migration ledger (also created by pageAccess) — created here too
    // in case the wing schema initialises first.
    await query(
      `CREATE TABLE IF NOT EXISTS app_migrations (
         name VARCHAR(128) PRIMARY KEY,
         applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ).catch(() => {});
    // Default-data seeds are idempotent (INSERT IGNORE / upsert) but can throw on a
    // transient lock; guard each so a seed hiccup doesn't abort the schema setup and
    // leave `ensured` false (which would re-run everything on the next read).
    try { await seedWings(); } catch (e) { console.error("[wing] seedWings:", e?.message || e); }
    try { await seedMainStateDesignations(); } catch (e) { console.error("[wing] seedMainState:", e?.message || e); }
    ensured = true;
    lastEnsureFailAt = 0;
    // ensured is set BEFORE this so the syncWing calls below (which call
    // ensureWingSchema) short-circuit instead of recursing.
    await backfillBlockLevel();
    await backfillDesignationRank();
    await backfillDesignationGlobalRank();
    await enforceOtherWingStructure();
  } catch (e) {
    lastEnsureFailAt = Date.now();
    console.error("[wing] ensure schema:", e?.message || e);
  }
}

// One-time: initialise the GLOBAL `rank` for every designation from the existing
// manual order — NEVER alphabetically. Rows are sequenced by level priority
// (State → Lok Sabha → District → Assembly → Block → Zone) and then by their
// existing within-group order (sort_order, then name), producing a clean global
// 1..N that matches the hierarchy the admin already sees. Only runs when no row is
// ranked yet, and is guarded by the migration ledger, so an admin-set rank is never
// overwritten. Existing ids/assignments/levels/wings are untouched.
async function backfillDesignationGlobalRank() {
  try {
    const done = await query(`SELECT 1 FROM app_migrations WHERE name = ? LIMIT 1`, ["designation_global_rank_v1"]).catch(() => []);
    if (done.length) return;
    const [{ n }] = await query("SELECT COUNT(*) AS n FROM designations WHERE `rank` IS NOT NULL").catch(() => [{ n: 0 }]);
    if (Number(n) === 0) {
      const rows = await query(
        `SELECT id FROM designations
          ORDER BY CASE level
                     WHEN 'state' THEN 0 WHEN 'lok_sabha' THEN 1 WHEN 'district' THEN 2
                     WHEN 'assembly' THEN 3 WHEN 'block' THEN 4 WHEN 'zone' THEN 5 ELSE 6 END,
                   (sort_order IS NULL), sort_order, name, id`
      );
      // Write rank AND mirror it into sort_order (+ manual_order=1) so every existing
      // ordering consumer — which already orders by sort_order — reflects the global
      // rank WITHOUT referencing the (possibly un-migrated) `rank` column in its SQL,
      // and the wing auto-generator never overwrites it.
      for (let i = 0; i < rows.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        await query("UPDATE designations SET `rank` = ?, sort_order = ?, manual_order = 1 WHERE id = ?", [i + 1, i + 1, rows[i].id]);
      }
    }
    await query(`INSERT IGNORE INTO app_migrations (name) VALUES (?)`, ["designation_global_rank_v1"]).catch(() => {});
  } catch (e) {
    console.error("[wing] backfillDesignationGlobalRank:", e?.message || e);
  }
}

// One-time: give every designation a stored Rank (sort_order) so none is left
// without an order. Only rows with a NULL sort_order are touched — they are
// appended to the END of their own (level, wing) group in INSERTION (id) order,
// never alphabetically — so existing manual order is fully preserved and no row
// moves. Guarded by the migration ledger so it runs at most once per deployment.
async function backfillDesignationRank() {
  try {
    const done = await query(`SELECT 1 FROM app_migrations WHERE name = ? LIMIT 1`, ["designation_rank_backfill_v1"]).catch(() => []);
    if (done.length) return;
    const groups = await query(
      `SELECT DISTINCT level, wing FROM designations WHERE sort_order IS NULL`
    ).catch(() => []);
    for (const g of groups) {
      // eslint-disable-next-line no-await-in-loop
      const [{ mx }] = await query(
        `SELECT COALESCE(MAX(sort_order), -1) AS mx FROM designations WHERE level <=> ? AND wing <=> ?`,
        [g.level ?? null, g.wing ?? null]
      );
      // eslint-disable-next-line no-await-in-loop
      const nulls = await query(
        `SELECT id FROM designations WHERE level <=> ? AND wing <=> ? AND sort_order IS NULL ORDER BY id ASC`,
        [g.level ?? null, g.wing ?? null]
      );
      let next = Number(mx) + 1;
      for (const row of nulls) {
        // eslint-disable-next-line no-await-in-loop
        await query(`UPDATE designations SET sort_order = ? WHERE id = ?`, [next++, row.id]);
      }
    }
    await query(`INSERT IGNORE INTO app_migrations (name) VALUES (?)`, ["designation_rank_backfill_v1"]).catch(() => {});
  } catch (e) {
    console.error("[wing] backfillDesignationRank:", e?.message || e);
  }
}

// One-time: regenerate every wing so the newly-added Block level materialises for
// wings that were configured before Block existed. syncWing upserts by
// (wing_base_id, level), so this only ADDS the missing Block rows — it never
// duplicates existing generated designations or touches assignments. Guarded by a
// migration flag so it runs at most once per deployment.
async function backfillBlockLevel() {
  try {
    const done = await query(`SELECT 1 FROM app_migrations WHERE name = ? LIMIT 1`, ["wing_block_level_v1"]).catch(() => []);
    if (done.length) return;
    const wings = await query(`SELECT id FROM wings WHERE is_main = 0`);
    for (const w of wings) {
      // eslint-disable-next-line no-await-in-loop
      await syncWing(w.id);
    }
    await query(`INSERT IGNORE INTO app_migrations (name) VALUES (?)`, ["wing_block_level_v1"]).catch(() => {});
  } catch (e) {
    console.error("[wing] backfillBlockLevel:", e?.message || e);
  }
}

async function ensureDesignationColumn(column, def) {
  try {
    // information_schema with a bound parameter: `SHOW COLUMNS … LIKE ?` is rejected
    // by MySQL 8 as a prepared statement, which silently prevented these columns
    // from ever being added.
    const rows = await query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'designations' AND COLUMN_NAME = ?`,
      [column]
    );
    if (!rows.length) await query(`ALTER TABLE designations ADD COLUMN \`${column}\` ${def}`);
  } catch (e) {
    console.error(`[wing] ensureDesignationColumn ${column}:`, e?.message || e);
  }
}

// Seed the Wing master once (Main Organisation + the 10 wings). Idempotent:
// INSERT IGNORE by unique name, and Main is only added if absent.
async function seedWings() {
  await query(
    `INSERT IGNORE INTO wings (name, sort_order, is_main) VALUES (?, 0, 1)`,
    [MAIN_WING]
  );
  for (let i = 0; i < SEED_WINGS.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    await query(`INSERT IGNORE INTO wings (name, sort_order, is_main) VALUES (?, ?, 0)`, [SEED_WINGS[i], i + 1]);
  }
}

// Ensure the 14 Main State Administration designations exist at State level in the
// exact sequence, tagged wing = Main Organisation. Uses upsert so an existing
// same-named designation keeps its id (and any assignments) but gets the correct
// order/level/wing. Runs once (guarded by app_migrations).
async function seedMainStateDesignations() {
  try {
    const done = await query(`SELECT 1 FROM app_migrations WHERE name = ? LIMIT 1`, ["seed_main_state_designations_v1"]).catch(() => []);
    if (done.length) return;
    for (let i = 0; i < MAIN_STATE_DESIGNATIONS.length; i++) {
      const name = MAIN_STATE_DESIGNATIONS[i];
      // eslint-disable-next-line no-await-in-loop
      await query(
        `INSERT INTO designations (name, level, sort_order, wing, enabled)
         VALUES (?, 'state', ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           level = COALESCE(NULLIF(level, ''), 'state'),
           sort_order = VALUES(sort_order),
           wing = VALUES(wing),
           enabled = 1`,
        [name, i, MAIN_WING]
      );
    }
    await query(`INSERT IGNORE INTO app_migrations (name) VALUES (?)`, ["seed_main_state_designations_v1"]).catch(() => {});
  } catch (e) {
    console.error("[wing] seedMainStateDesignations:", e?.message || e);
  }
}

// List every wing (ordered: Main first, then by sort_order/name).
export async function listWings() {
  await ensureWingSchema();
  return query(`SELECT id, name, sort_order, is_main, enabled FROM wings ORDER BY is_main DESC, sort_order ASC, name ASC`);
}

export async function getWing(wingId) {
  await ensureWingSchema();
  const [w] = await query(`SELECT id, name, sort_order, is_main, enabled FROM wings WHERE id = ?`, [wingId]);
  return w || null;
}

// A wing's base roles, in order (all, including disabled — the UI shows the toggle).
export async function listWingBases(wingId) {
  await ensureWingSchema();
  return query(`SELECT id, wing_id, base_name, sort_order, enabled FROM wing_designations WHERE wing_id = ? ORDER BY sort_order ASC, id ASC`, [wingId]);
}

// AUTO-GENERATION / SYNC — materialise a wing's base roles into `designations`
// across all four levels, preserving order. Idempotent and assignment-safe:
//   • each generated row is linked by wing_base_id, so a rename/reorder updates it
//     IN PLACE (id + assignments preserved);
//   • a removed/disabled base disables (never deletes) its generated rows, so an
//     assigned person is never silently unassigned.
export async function syncWing(wingId) {
  await ensureWingSchema();
  const wing = await getWing(wingId);
  if (!wing || wing.is_main) return; // Main Organisation is fixed State — not generated.
  const bases = await listWingBases(wingId);
  const baseIds = bases.map((b) => b.id);
  // Other Wings follow the fixed structure (lib/otherWingStructure): a generated designation is enabled only when its role is
  // permitted at that level (State: President + Sangathan Mantri; Lok Sabha / District / Assembly: President, Prabhari,
  // Sangathan Mantri; no Block). Anything else is generated DISABLED (kept, never deleted, assignments untouched).
  const isOther = !!otherWingOf(wing.name);
  for (const base of bases) {
    const role = owRoleOfBase(base.base_name);
    for (let li = 0; li < WING_LEVELS.length; li++) {
      const level = WING_LEVELS[li].key;
      const on = base.enabled && (!isOther || owAllowed(level, role)) ? 1 : 0;
      const name = generatedName(level, base.base_name, wing.name);
      // Global order = base order across levels; keep levels grouped by base order.
      const sort = base.sort_order * 10 + li;
      // eslint-disable-next-line no-await-in-loop
      const [existing] = await query(
        `SELECT id FROM designations WHERE wing_base_id = ? AND level = ? LIMIT 1`,
        [base.id, level]
      );
      try {
        if (existing) {
          // Preserve a manually-configured order: sort_order is only refreshed from
          // the generated sequence when the bucket has NOT been hand-ordered. `rank`
          // (the global primary order) is mirrored from the same value in lockstep so
          // rank-ordered screens and sort_order-ordered screens never disagree (M2) —
          // again only when the bucket has NOT been hand-ordered/ranked.
          // eslint-disable-next-line no-await-in-loop
          await query(
            "UPDATE designations SET name = ?, level = ?, wing = ?," +
              " sort_order = IF(manual_order = 1, sort_order, ?)," +
              " `rank` = IF(manual_order = 1, `rank`, ?), enabled = ? WHERE id = ?",
            [name, level, wing.name, sort, sort, on, existing.id]
          );
        } else {
          // New generated row: seed BOTH sort_order and the global `rank` from the
          // generated hierarchical position, so it lands in its correct place on every
          // screen immediately instead of sorting to the bottom with rank = NULL (M2).
          // eslint-disable-next-line no-await-in-loop
          await query(
            "INSERT INTO designations (name, level, wing, wing_base_id, sort_order, `rank`, enabled)" +
              " VALUES (?, ?, ?, ?, ?, ?, ?)" +
              " ON DUPLICATE KEY UPDATE level = VALUES(level), wing = VALUES(wing)," +
              " wing_base_id = VALUES(wing_base_id), sort_order = VALUES(sort_order)," +
              " `rank` = VALUES(`rank`), enabled = VALUES(enabled)",
            [name, level, wing.name, base.id, sort, sort, on]
          );
        }
      } catch (e) {
        // A name collision with an unrelated designation is non-fatal — skip that one.
        console.error(`[wing] syncWing upsert "${name}":`, e?.code || e?.message || e);
      }
    }
  }

  // Disable generated rows whose base was removed (kept for audit + assignments).
  if (baseIds.length) {
    const ph = baseIds.map(() => "?").join(",");
    await query(
      `UPDATE designations SET enabled = 0 WHERE wing = ? AND wing_base_id IS NOT NULL AND wing_base_id NOT IN (${ph})`,
      [wing.name, ...baseIds]
    );
  } else {
    await query(`UPDATE designations SET enabled = 0 WHERE wing = ? AND wing_base_id IS NOT NULL`, [wing.name]);
  }
}

// OTHER WINGS — enforce the fixed structure in the master (idempotent; once per process, re-tried after a failure):
//   • exactly the 15 Other Wings are enabled non-main Wings (created if missing); any other non-main Wing is disabled;
//   • each has exactly the base roles President, Prabhari, Sangathan Mantri (an existing spelling such as "Adhyaksh" /
//     "Sanghathan Mantri" is kept for its role — its designation ids and assignments stay); every other base is disabled;
//   • its designations are (re)generated by syncWing, which enables only the permitted level × role combinations;
//   • a hand-made designation of the Wing (not generated from a base) is disabled — ONLY when its FULL Wing mapping
//     (designation_wings, else designations.wing) has no Main Wing. designations.wing holds just the FIRST selected Wing of a
//     multi-Wing designation, so a Main designation shared with Other Wings (e.g. "Loksabha President" mapped to SC, ST, …, Main)
//     can carry an Other Wing there: it stays enabled and counts as a Main Wing post. (v0.1.607 checked only that column and
//     disabled such shared Main designations — restoreSharedMainDesignations re-enables them.)
// Nothing is deleted: disabled designations keep every member's assignment and history.
let _mainWingNames = null;
function isMainWingName(w) {
  const n = String(w || "").trim().replace(/\s+/g, " ").toLowerCase();
  return (_mainWingNames && _mainWingNames.has(n)) || /^main(\s+organi[sz]ations?)?$/.test(n);
}

// One-time repair of v0.1.607: re-enable every non-generated designation tagged to an Other Wing whose full Wing mapping includes
// the Main Wing (a Main designation shared with Other Wings — what that version disabled by mistake). Guarded by the migration ledger.
async function restoreSharedMainDesignations() {
  const MIG = "ow_restore_shared_main_designations_v1";
  const done = await query(`SELECT 1 FROM app_migrations WHERE name = ? LIMIT 1`, [MIG]).catch(() => []);
  if (done.length) return;
  const names = OTHER_WINGS.map((w) => w.name);
  const rows = await query(
    `SELECT id, wing FROM designations WHERE enabled = 0 AND wing_base_id IS NULL AND wing IN (${names.map(() => "?").join(",")})`,
    names
  );
  if (rows.length) {
    const wm = await wingsMapFor(rows);
    const ids = rows.filter((d) => (wm.get(d.id) || []).some(isMainWingName)).map((d) => d.id);
    if (ids.length) {
      await query(`UPDATE designations SET enabled = 1 WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
      console.log(`[wing] re-enabled ${ids.length} Main designation(s) shared with Other Wings (wrongly disabled by v0.1.607): ${ids.join(", ")}`);
    }
  }
  await query(`INSERT IGNORE INTO app_migrations (name) VALUES (?)`, [MIG]).catch(() => {});
}

let _owEnforce = null;
export function enforceOtherWingStructure() {
  if (!_owEnforce) {
    _owEnforce = (async () => {
      _mainWingNames = new Set((await query(`SELECT name FROM wings WHERE is_main = 1`)).map((x) => String(x.name).trim().replace(/\s+/g, " ").toLowerCase()));
      for (let i = 0; i < OTHER_WINGS.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        await query(`INSERT IGNORE INTO wings (name, sort_order, is_main, enabled) VALUES (?, ?, 0, 1)`, [OTHER_WINGS[i].name, i + 1]);
      }
      const wings = await query(`SELECT id, name, is_main, enabled FROM wings`);
      for (const w of wings) {
        if (Number(w.is_main) === 1) continue;
        const canon = otherWingOf(w.name);
        // eslint-disable-next-line no-await-in-loop
        if (!canon || canon !== w.name) { await query(`UPDATE wings SET enabled = 0 WHERE id = ?`, [w.id]); continue; }
        // eslint-disable-next-line no-await-in-loop
        await query(`UPDATE wings SET enabled = 1 WHERE id = ?`, [w.id]);
        // eslint-disable-next-line no-await-in-loop
        const bases = await query(`SELECT id, base_name, enabled FROM wing_designations WHERE wing_id = ? ORDER BY sort_order ASC, id ASC`, [w.id]);
        const taken = new Map();
        for (const b of bases) {
          const role = owRoleOfBase(b.base_name);
          if (role && !taken.has(role)) taken.set(role, b.id);
          else if (Number(b.enabled) !== 0) {
            // eslint-disable-next-line no-await-in-loop
            await query(`UPDATE wing_designations SET enabled = 0 WHERE id = ?`, [b.id]);
          }
        }
        for (let ri = 0; ri < OW_ROLES.length; ri++) {
          const r = OW_ROLES[ri];
          if (taken.has(r.key)) {
            // eslint-disable-next-line no-await-in-loop
            await query(`UPDATE wing_designations SET enabled = 1, sort_order = ? WHERE id = ?`, [ri, taken.get(r.key)]);
          } else {
            // eslint-disable-next-line no-await-in-loop
            await query(
              `INSERT INTO wing_designations (wing_id, base_name, sort_order, enabled) VALUES (?, ?, ?, 1)
               ON DUPLICATE KEY UPDATE enabled = 1, sort_order = VALUES(sort_order)`,
              [w.id, r.base, ri]
            );
          }
        }
        // eslint-disable-next-line no-await-in-loop
        await syncWing(w.id);
        // eslint-disable-next-line no-await-in-loop
        const tagged = await query(`SELECT id, wing FROM designations WHERE wing = ? AND wing_base_id IS NULL AND enabled <> 0`, [w.name]);
        if (tagged.length) {
          // eslint-disable-next-line no-await-in-loop
          const wm = await wingsMapFor(tagged);
          const otherOnly = tagged.filter((d) => !(wm.get(d.id) || []).some(isMainWingName)).map((d) => d.id);
          // eslint-disable-next-line no-await-in-loop
          if (otherOnly.length) await query(`UPDATE designations SET enabled = 0 WHERE id IN (${otherOnly.map(() => "?").join(",")})`, otherOnly);
        }
      }
      await restoreSharedMainDesignations();
    })().catch((e) => { _owEnforce = null; console.error("[wing] enforceOtherWingStructure:", e?.message || e); });
  }
  return _owEnforce;
}

// The generated designations for a wing, grouped by level (for the master preview
// and for organizational assignment). Reads the materialised `designations` rows.
export async function generatedForWing(wingId) {
  await ensureWingSchema();
  const wing = await getWing(wingId);
  if (!wing) return { levels: {}, main: [] };
  if (wing.is_main) {
    const rows = await query(
      `SELECT id, name, level, sort_order, enabled FROM designations
        WHERE wing = ? ORDER BY (sort_order IS NULL), sort_order ASC, name ASC`,
      [wing.name]
    );
    return { is_main: true, name: wing.name, main: rows };
  }
  const byLevel = {};
  for (const l of WING_LEVELS) byLevel[l.key] = [];
  const rows = await query(
    `SELECT id, name, level, sort_order, enabled FROM designations
      WHERE wing = ? AND wing_base_id IS NOT NULL
      ORDER BY sort_order ASC, name ASC`,
    [wing.name]
  );
  for (const r of rows) if (byLevel[r.level]) byLevel[r.level].push(r);
  return { is_main: false, name: wing.name, levels: byLevel };
}

// Whether a designation currently has any assigned people (for safe delete).
export async function designationHasAssignments(designationId) {
  const [a] = await query(`SELECT COUNT(*) AS n FROM contact_designations WHERE designation_id = ?`, [designationId]);
  const [b] = await query(`SELECT COUNT(*) AS n FROM contacts WHERE designation_id = ?`, [designationId]);
  return (Number(a?.n) || 0) + (Number(b?.n) || 0) > 0;
}
