import { query } from "@/lib/db";
import { CG_ASSEMBLIES, normDistrict } from "@/lib/chhattisgarhAssemblies";

// ---------------------------------------------------------------------------
// Leader / Assembly Assessment module — schema (lazy, idempotent) + shared
// helpers. Tables are prefixed `la_` and are entirely self-contained: they only
// reference each other, never the app's existing tables, so this module cannot
// affect Contacts / Tasks / Reports / etc. Created on first use (the Hostinger
// deploy flow has no manual migration step), mirroring taskSchema.js.
// ---------------------------------------------------------------------------

let ensured = false;
export async function ensureLeaderAssessmentTables() {
  if (ensured) return;
  const ddl = [
    `CREATE TABLE IF NOT EXISTS la_assemblies (
       id INT AUTO_INCREMENT PRIMARY KEY,
       name VARCHAR(255) NOT NULL,
       number VARCHAR(50) NULL,
       district VARCHAR(255) NULL,
       lok_sabha VARCHAR(255) NULL,
       total_voters INT NULL,
       total_polling_stations INT NULL,
       total_booths INT NULL,
       election_year INT NULL,
       population INT NULL,
       notes TEXT NULL,
       created_by_user_id INT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       INDEX idx_la_asm_name (name),
       INDEX idx_la_asm_district (district)
     )`,
    `CREATE TABLE IF NOT EXISTS la_mla_profiles (
       id INT AUTO_INCREMENT PRIMARY KEY,
       assembly_id INT NOT NULL,
       photo_url VARCHAR(1000) NULL,
       name VARCHAR(255) NULL,
       phone VARCHAR(50) NULL,
       address TEXT NULL,
       date_of_birth DATE NULL,
       caste VARCHAR(255) NULL,
       party VARCHAR(255) NULL,
       net_worth VARCHAR(255) NULL,
       criminal_cases INT NULL,
       times_won INT NULL,
       times_contested INT NULL,
       largest_winning_margin INT NULL,
       previous_winning_margin INT NULL,
       party_won_from VARCHAR(255) NULL,
       party_defeated VARCHAR(255) NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       UNIQUE KEY uq_la_mla_assembly (assembly_id),
       CONSTRAINT fk_la_mla_asm FOREIGN KEY (assembly_id) REFERENCES la_assemblies(id) ON DELETE CASCADE
     )`,
    `CREATE TABLE IF NOT EXISTS la_mla_elections (
       id INT AUTO_INCREMENT PRIMARY KEY,
       assembly_id INT NOT NULL,
       election_year INT NULL,
       election_type VARCHAR(100) NULL,
       party VARCHAR(255) NULL,
       candidate VARCHAR(255) NULL,
       status VARCHAR(50) NULL,
       votes INT NULL,
       vote_percentage DECIMAL(5,2) NULL,
       margin INT NULL,
       result VARCHAR(50) NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       INDEX idx_la_elec_asm (assembly_id),
       CONSTRAINT fk_la_elec_asm FOREIGN KEY (assembly_id) REFERENCES la_assemblies(id) ON DELETE CASCADE
     )`,
    `CREATE TABLE IF NOT EXISTS la_political_analysis (
       id INT AUTO_INCREMENT PRIMARY KEY,
       assembly_id INT NOT NULL,
       reasons_won TEXT NULL,
       weaknesses TEXT NULL,
       strengths TEXT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       UNIQUE KEY uq_la_analysis_asm (assembly_id),
       CONSTRAINT fk_la_analysis_asm FOREIGN KEY (assembly_id) REFERENCES la_assemblies(id) ON DELETE CASCADE
     )`,
    `CREATE TABLE IF NOT EXISTS la_social_structure (
       id INT AUTO_INCREMENT PRIMARY KEY,
       assembly_id INT NOT NULL,
       rank_no INT NULL,
       name VARCHAR(255) NULL,
       percentage DECIMAL(5,2) NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       INDEX idx_la_social_asm (assembly_id),
       CONSTRAINT fk_la_social_asm FOREIGN KEY (assembly_id) REFERENCES la_assemblies(id) ON DELETE CASCADE
     )`,
    `CREATE TABLE IF NOT EXISTS la_aap_candidates (
       id INT AUTO_INCREMENT PRIMARY KEY,
       assembly_id INT NOT NULL,
       photo_url VARCHAR(1000) NULL,
       name VARCHAR(255) NULL,
       phone VARCHAR(50) NULL,
       address TEXT NULL,
       date_of_birth DATE NULL,
       caste VARCHAR(255) NULL,
       net_worth VARCHAR(255) NULL,
       business VARCHAR(255) NULL,
       monthly_income VARCHAR(255) NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       INDEX idx_la_cand_asm (assembly_id),
       CONSTRAINT fk_la_cand_asm FOREIGN KEY (assembly_id) REFERENCES la_assemblies(id) ON DELETE CASCADE
     )`,
    `CREATE TABLE IF NOT EXISTS la_candidate_assessments (
       id INT AUTO_INCREMENT PRIMARY KEY,
       candidate_id INT NOT NULL,
       s_nature TINYINT NULL, s_hardworker TINYINT NULL, s_financial TINYINT NULL,
       s_political TINYINT NULL, s_public_reach TINYINT NULL, s_social_reach TINYINT NULL,
       s_personality TINYINT NULL, s_organization TINYINT NULL, s_winning TINYINT NULL,
       s_acceptability TINYINT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       UNIQUE KEY uq_la_assess_cand (candidate_id),
       CONSTRAINT fk_la_assess_cand FOREIGN KEY (candidate_id) REFERENCES la_aap_candidates(id) ON DELETE CASCADE
     )`,
    `CREATE TABLE IF NOT EXISTS la_candidate_strategy (
       id INT AUTO_INCREMENT PRIMARY KEY,
       assembly_id INT NOT NULL,
       mla_biggest_weakness TEXT NULL,
       aap_biggest_strength TEXT NULL,
       target_community VARCHAR(255) NULL,
       target_booth VARCHAR(255) NULL,
       main_issue TEXT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       UNIQUE KEY uq_la_strategy_asm (assembly_id),
       CONSTRAINT fk_la_strategy_asm FOREIGN KEY (assembly_id) REFERENCES la_assemblies(id) ON DELETE CASCADE
     )`,
  ];
  for (const stmt of ddl) await query(stmt);
  // Optional columns added after the initial release. Ensured idempotently so
  // both fresh and already-created deployments get them without a manual step.
  await ensureColumn("la_aap_candidates", "education", "VARCHAR(255) NULL");
  await ensureColumn("la_aap_candidates", "political_experience", "VARCHAR(500) NULL");
  await ensureColumn("la_aap_candidates", "organization_experience", "VARCHAR(500) NULL");
  await ensureColumn("la_aap_candidates", "previous_elections", "VARCHAR(500) NULL");
  await ensureColumn("la_aap_candidates", "current_position", "VARCHAR(255) NULL");
  await ensureColumn("la_mla_elections", "runner_up", "VARCHAR(255) NULL");
  await ensureColumn("la_mla_elections", "runner_up_votes", "INT NULL");
  // Election History is entered against a person picked via District → Category
  // (AAP / MLA / Candidate) → Name; the category is stored so editing reloads it.
  await ensureColumn("la_mla_elections", "person_category", "VARCHAR(50) NULL");
  // Required-worker target (fixed reference value) and a FK to the real
  // locations district (used to compute the LIVE worker count).
  await ensureColumn("la_assemblies", "required_workers", "INT NULL");
  await ensureColumn("la_assemblies", "district_id", "INT NULL");
  await seedLeaderAssemblies();
  ensured = true;
}

// Idempotent master seed for the 33 Chhattisgarh assemblies (names + fixed
// Required-Worker targets from src/lib/chhattisgarhAssemblies.js). This is
// deterministic — it does NOT depend on the contents of `locations` for the
// insert, so it populates reliably on any deployment. For each assembly it also
// resolves the matching `locations` district id (via the alias table) and
// stores it as district_id, which powers the live worker count. NO MLA,
// candidate, election, vote or caste data is created — those remain empty and
// render as "Not Available"/"Not Added" until entered through the UI.
//
// Idempotency: an assembly is matched to any existing row by normalized name
// (canonical name OR any alias), so running repeatedly — or after the earlier
// district-named seed — never creates duplicates. Existing rows are only
// BACK-FILLED (required_workers / district_id set when NULL); an admin-edited
// name is never overwritten. New assemblies are inserted with the canonical
// name. End state: exactly one row per assembly.
async function seedLeaderAssemblies() {
  try {
    const districts = await query("SELECT id, name FROM locations WHERE type = 'district'");
    const districtByNorm = new Map();
    for (const d of districts) districtByNorm.set(normDistrict(d.name), d.id);

    const existing = await query("SELECT id, name FROM la_assemblies");
    const existingByNorm = new Map();
    for (const r of existing) existingByNorm.set(normDistrict(r.name), r);

    for (const a of CG_ASSEMBLIES) {
      let districtId = null;
      for (const al of a.aliases) {
        const id = districtByNorm.get(normDistrict(al));
        if (id) { districtId = id; break; }
      }
      let row = null;
      for (const al of [a.name, ...a.aliases]) {
        const r = existingByNorm.get(normDistrict(al));
        if (r) { row = r; break; }
      }
      if (row) {
        // Back-fill reference fields only; never clobber an admin-edited name.
        await query(
          `UPDATE la_assemblies
              SET required_workers = COALESCE(required_workers, ?),
                  district_id = COALESCE(district_id, ?)
            WHERE id = ?`,
          [a.requiredWorkers, districtId, row.id]
        );
      } else {
        const res = await query(
          `INSERT INTO la_assemblies (name, district, required_workers, district_id)
           VALUES (?, ?, ?, ?)`,
          [a.name, a.name, a.requiredWorkers, districtId]
        );
        existingByNorm.set(normDistrict(a.name), { id: res.insertId, name: a.name });
      }
    }
  } catch (e) {
    console.error("[LA] seedLeaderAssemblies:", e?.message || e);
  }
}

// Add a column only if it's missing (cross-DB safe: check information_schema
// first, so no reliance on ADD COLUMN IF NOT EXISTS which MySQL lacks).
async function ensureColumn(table, column, def) {
  try {
    const rows = await query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    if (Number(rows[0]?.n || 0) === 0) {
      await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    }
  } catch (e) { console.error(`[LA] ensureColumn ${table}.${column}:`, e?.message || e); }
}

// The 10 assessment parameters. `key` = column suffix, `label` = UI label.
export const ASSESSMENT_PARAMS = [
  { key: "s_nature", label: "Candidate Nature" },
  { key: "s_hardworker", label: "Hard Worker" },
  { key: "s_financial", label: "Financial Condition" },
  { key: "s_political", label: "Political Knowledge" },
  { key: "s_public_reach", label: "Public Reach" },
  { key: "s_social_reach", label: "Social / Samajik Reach" },
  { key: "s_personality", label: "Personality" },
  { key: "s_organization", label: "Organization Strength" },
  { key: "s_winning", label: "Winning Ability" },
  { key: "s_acceptability", label: "Public Acceptability" },
];

// Sum of the 10 scores (each 0–10) → 0–100. The total is ALWAYS computed, never
// stored/entered. Missing scores count as 0.
export function assessmentTotal(a) {
  if (!a) return 0;
  return ASSESSMENT_PARAMS.reduce((sum, p) => sum + (Number(a[p.key]) || 0), 0);
}

// Automatic age from DOB using today's date. Returns null when DOB is absent —
// callers show "Age not available". DOB is the single source of truth.
export function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

// Rank candidates by TOTAL score (desc). Tie-breaker, in order: (1) Winning
// Ability, (2) Public Acceptability, (3) lowest candidate id (stable). Ranking
// is fully derived — never user-editable.
export function rankCandidates(candidates) {
  const sorted = [...candidates]
    .map((c) => ({ ...c, total: assessmentTotal(c.assessment) }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const wa = (Number(b.assessment?.s_winning) || 0) - (Number(a.assessment?.s_winning) || 0);
      if (wa !== 0) return wa;
      const pa = (Number(b.assessment?.s_acceptability) || 0) - (Number(a.assessment?.s_acceptability) || 0);
      if (pa !== 0) return pa;
      return a.id - b.id;
    });
  // Competition ranking: equal totals share the same rank (e.g. 85,85,74 →
  // ranks 1,1,3). `tied` flags a shared rank for the UI.
  return sorted.map((c) => {
    const rank = 1 + sorted.filter((o) => o.total > c.total).length;
    const tied = sorted.filter((o) => o.total === c.total).length > 1;
    return { ...c, rank, tied };
  });
}

// Validate a single 0–10 score. Returns a number, or null for empty; throws a
// string message for invalid input.
export function normalizeScore(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 10) {
    throw "Each score must be a whole number between 0 and 10.";
  }
  return n;
}

// Parse a stored JSON-array text field (reasons/weaknesses/strengths) safely.
export function parseList(txt) {
  if (!txt) return [];
  try { const v = JSON.parse(txt); return Array.isArray(v) ? v : []; } catch { return []; }
}
