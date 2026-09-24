import { query } from "@/lib/db";
import { ensureDesignationLevelColumn } from "@/lib/designationLevels";

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

// The four organizational levels designations generate across, in order.
export const WING_LEVELS = [
  { key: "state", label: "State" },
  { key: "lok_sabha", label: "Lok Sabha" },
  { key: "district", label: "District" },
  { key: "assembly", label: "Assembly" },
];
const LEVEL_LABEL = Object.fromEntries(WING_LEVELS.map((l) => [l.key, l.label]));

// The seeded wings. Main Organisation is special (fixed State designations, no
// level generation); the 10 wings are level-generated from their own base roles.
export const MAIN_WING = "Main Organisation";
const SEED_WINGS = [
  "SC Wing", "Social Media Wing", "Youth Wing", "Legal Wing", "OBC Wing",
  "Women Wing", "Transport Wing", "RTI Wing", "Ex-Employee Wing", "Karmchari Wing",
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
export async function ensureWingSchema() {
  if (ensured) return;
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
    if (!(await query("SHOW COLUMNS FROM designations LIKE 'sort_order'")).length) {
      await ensureDesignationColumn("sort_order", "INT NULL");
    }

    // The one-time-migration ledger (also created by pageAccess) — created here too
    // in case the wing schema initialises first.
    await query(
      `CREATE TABLE IF NOT EXISTS app_migrations (
         name VARCHAR(128) PRIMARY KEY,
         applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ).catch(() => {});
    await seedWings();
    await seedMainStateDesignations();
    ensured = true;
  } catch (e) {
    console.error("[wing] ensure schema:", e?.message || e);
  }
}

async function ensureDesignationColumn(column, def) {
  try {
    const rows = await query("SHOW COLUMNS FROM designations LIKE ?", [column]);
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

  for (const base of bases) {
    for (let li = 0; li < WING_LEVELS.length; li++) {
      const level = WING_LEVELS[li].key;
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
          // eslint-disable-next-line no-await-in-loop
          await query(
            `UPDATE designations SET name = ?, level = ?, wing = ?, sort_order = ?, enabled = ? WHERE id = ?`,
            [name, level, wing.name, sort, base.enabled ? 1 : 0, existing.id]
          );
        } else {
          // eslint-disable-next-line no-await-in-loop
          await query(
            `INSERT INTO designations (name, level, wing, wing_base_id, sort_order, enabled)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE level = VALUES(level), wing = VALUES(wing),
               wing_base_id = VALUES(wing_base_id), sort_order = VALUES(sort_order), enabled = VALUES(enabled)`,
            [name, level, wing.name, base.id, sort, base.enabled ? 1 : 0]
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
