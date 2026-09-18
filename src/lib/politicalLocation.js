import { query } from "@/lib/db";

// Assembly → Block management for the Political Location master (Administration →
// Master Data). A "Block" is a `locations` row of type='ward' (labelled "Block" in
// the UI) whose parent_id is its Assembly — so the Assembly→Block relationship is
// the existing hierarchy, stored by IDs (block.parent_id → assembly.id), never by
// name. This module adds the bilingual name + duplicate-safety + validation the
// spec requires, on top of that existing master. It is the single source of truth.

const BLOCK_TYPE = "ward"; // the location type the UI shows as "Block"

// Add the optional columns a Block needs, once per process. Additive only — every
// existing location query keeps working (it just ignores these columns).
let ensured = false;
export async function ensureBlockColumns() {
  if (ensured) return;
  try {
    const cols = await query(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations'
          AND COLUMN_NAME IN ('name_hi','status')`
    );
    const have = new Set(cols.map((r) => r.c));
    if (!have.has("name_hi")) await query("ALTER TABLE locations ADD COLUMN name_hi VARCHAR(191) NULL");
    if (!have.has("status")) await query("ALTER TABLE locations ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active'");
    ensured = true;
  } catch (e) {
    console.error("[politicalLocation] ensureBlockColumns:", e?.message || e);
  }
}

// Normalised key for duplicate detection: trim, collapse internal whitespace,
// lowercase. Used ONLY to compare — the stored display name is never altered.
export function normalizeBlockName(s) {
  return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Only Blocks belonging to THIS assembly (by id) — never another assembly's.
export async function blocksForAssembly(assemblyId) {
  await ensureBlockColumns();
  const id = Number(assemblyId);
  if (!Number.isInteger(id) || id <= 0) return [];
  return query(
    `SELECT id, name AS name_en, name_hi, COALESCE(status,'active') AS status
       FROM locations WHERE type = ? AND parent_id = ? ORDER BY name ASC`,
    [BLOCK_TYPE, id]
  );
}

// Backend validation (§12): does this block_id actually belong to this assembly_id?
// A form that saves both must call this before persisting — frontend checks alone
// are not enough. Returns true only for a real Block whose parent is that assembly.
export async function blockBelongsToAssembly(blockId, assemblyId) {
  const b = Number(blockId), a = Number(assemblyId);
  if (!Number.isInteger(b) || !Number.isInteger(a)) return false;
  const [row] = await query(
    `SELECT 1 AS ok FROM locations WHERE id = ? AND type = ? AND parent_id = ? LIMIT 1`,
    [b, BLOCK_TYPE, a]
  );
  return !!row;
}

// True when `assemblyId` is a real assembly (a valid parent for a Block).
export async function isAssembly(assemblyId) {
  const a = Number(assemblyId);
  if (!Number.isInteger(a)) return false;
  const [row] = await query(`SELECT 1 AS ok FROM locations WHERE id = ? AND type = 'assembly' LIMIT 1`, [a]);
  return !!row;
}

// The required Assembly → Block master mapping supplied in the spec. Seeding is
// idempotent and matched to EXISTING assemblies by name (case-insensitive) — it
// never creates a duplicate assembly, and never a duplicate block within an
// assembly (normalised compare). Assemblies not found by name are reported, not
// invented. Names not in this list are left untouched.
export const REQUIRED_ASSEMBLY_BLOCKS = {
  "Bharatpur Sonhat": ["Block Bharatpur", "Kotadol", "Kunwarpur", "Kelhari", "Nagpur"],
  "Manendragarh": ["Manendragarh City", "Chirmiri-Badi Bazar", "Chirmiri-Godripara", "Khadgawan", "Ledri"],
  "Sakti": ["Baradwar", "Sakti", "Nagarda", "Seoni", "Saragaon"],
  "Prem Nagar": ["GANESHPUR", "SURAJPUR", "VISHRAMPUR", "RAMANUJNAGAR", "PREMNAGAR"],
  "Bhatgaon": ["Biharpur", "Odagi", "Bhaiyathan", "Bhatgao", "Latori"],
  "Pratappur": ["Jarahi", "Pratappur", "Chalgali", "Wadrafnagar", "Raghunath Nagar"],
  "Samri": ["RAJPUR", "BARIYON", "SAMRI", "SHANKARGARH", "KUSMI"],
  "Ambikapur": ["Ambikapur", "Dandgaon", "Udaipur", "Lakhanpur", "Sapna"],
  "Sitapur": ["Sitapur", "Mainpaat", "Batauli", "Boda", "Damali"],
};

export async function seedAssemblyBlocks() {
  await ensureBlockColumns();
  const assemblies = await query(`SELECT id, name FROM locations WHERE type = 'assembly'`);
  const byName = new Map(assemblies.map((a) => [normalizeBlockName(a.name), a.id]));
  const report = { created: 0, skippedExisting: 0, assembliesMatched: 0, assembliesNotFound: [] };
  for (const [asmName, blocks] of Object.entries(REQUIRED_ASSEMBLY_BLOCKS)) {
    const asmId = byName.get(normalizeBlockName(asmName));
    if (!asmId) { report.assembliesNotFound.push(asmName); continue; }
    report.assembliesMatched += 1;
    const existing = await query(`SELECT name FROM locations WHERE type = ? AND parent_id = ?`, [BLOCK_TYPE, asmId]);
    const existSet = new Set(existing.map((r) => normalizeBlockName(r.name)));
    for (const block of blocks) {
      if (existSet.has(normalizeBlockName(block))) { report.skippedExisting += 1; continue; }
      await query(`INSERT INTO locations (type, name, parent_id, status) VALUES (?, ?, ?, 'active')`, [BLOCK_TYPE, block, asmId]);
      existSet.add(normalizeBlockName(block));
      report.created += 1;
    }
  }
  return report;
}
