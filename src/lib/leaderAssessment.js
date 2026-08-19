import { query } from "@/lib/db";
import { normDistrict, requiredWorkersFor } from "@/lib/chhattisgarhAssemblies";

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
    // Normalized store for the political-analysis lists (Winning Reasons /
    // Strengths / Weaknesses): one row per point, ordered, keyed to the assembly
    // by FK — instead of an unstructured JSON blob. la_political_analysis is kept
    // in sync as a compatibility mirror.
    `CREATE TABLE IF NOT EXISTS la_political_points (
       id INT AUTO_INCREMENT PRIMARY KEY,
       assembly_id INT NOT NULL,
       kind ENUM('reason','strength','weakness') NOT NULL,
       sort_order INT NOT NULL DEFAULT 0,
       content VARCHAR(1000) NOT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       INDEX idx_la_points_asm_kind (assembly_id, kind, sort_order),
       CONSTRAINT fk_la_points_asm FOREIGN KEY (assembly_id) REFERENCES la_assemblies(id) ON DELETE CASCADE
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
    // Sitting-MLA assessment — the SAME 10 parameters as the candidate
    // assessment, one row per MLA profile. Kept separate from the candidate
    // scores so neither can affect the other.
    `CREATE TABLE IF NOT EXISTS la_mla_assessments (
       id INT AUTO_INCREMENT PRIMARY KEY,
       mla_id INT NOT NULL,
       s_nature TINYINT NULL, s_hardworker TINYINT NULL, s_financial TINYINT NULL,
       s_political TINYINT NULL, s_public_reach TINYINT NULL, s_social_reach TINYINT NULL,
       s_personality TINYINT NULL, s_organization TINYINT NULL, s_winning TINYINT NULL,
       s_acceptability TINYINT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       UNIQUE KEY uq_la_assess_mla (mla_id),
       CONSTRAINT fk_la_assess_mla FOREIGN KEY (mla_id) REFERENCES la_mla_profiles(id) ON DELETE CASCADE
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
  // Reference to the authoritative Master Data assembly (locations.id where
  // type='assembly'). When set, the row mirrors a master assembly and the module
  // lists it; legacy rows (NULL) are kept but hidden once master rows exist.
  await ensureColumn("la_assemblies", "location_id", "INT NULL");
  try { await query("CREATE UNIQUE INDEX uq_la_asm_location ON la_assemblies (location_id)"); } catch { /* index already exists */ }
  await syncAssemblies();
  ensured = true;
}

// Mirror the authoritative Master Data assemblies — the `locations` rows of
// type 'assembly' — into la_assemblies, keyed by location_id. Master Data is the
// SINGLE SOURCE OF TRUTH: this only ever adds/updates mirror rows to match
// master (and adopts a legacy row into master where the names line up). It never
// hardcodes names, never seeds a fallback list, and never deletes — so existing
// MLA / candidate / election / assessment data is always preserved. Cheap in
// steady state (two SELECTs, no writes when nothing changed), so it's safe to
// run on every Overview / assemblies request to keep the module in step with
// master. Exported so those routes can refresh the mirror per request.
export async function syncAssemblies() {
  try {
    const masters = await query(
      `SELECT a.id AS location_id, a.name AS name,
              d.id AS district_id, d.name AS district_name
         FROM locations a
         LEFT JOIN locations d ON d.id = a.parent_id AND d.type = 'district'
        WHERE a.type = 'assembly'`
    );
    // No master assemblies configured → nothing to mirror. The module then shows
    // a proper empty state instead of any seeded / hardcoded fallback.
    if (!masters.length) return;

    const existing = await query("SELECT id, location_id, name, district, district_id FROM la_assemblies");
    const linked = new Map();          // location_id -> existing mirror row
    const unlinkedByNorm = new Map();  // normalized name -> legacy row (location_id NULL)
    for (const r of existing) {
      if (r.location_id != null) linked.set(Number(r.location_id), r);
      else if (!unlinkedByNorm.has(normDistrict(r.name))) unlinkedByNorm.set(normDistrict(r.name), r);
    }

    for (const m of masters) {
      const req = m.district_name ? requiredWorkersFor(m.district_name) : null;
      const cur = linked.get(Number(m.location_id));
      if (cur) {
        // Keep the mirror's authoritative fields in step with master, but only
        // write when something actually changed (keeps steady-state cost at 0).
        const changed = cur.name !== m.name
          || (cur.district || null) !== (m.district_name || null)
          || Number(cur.district_id || 0) !== Number(m.district_id || 0);
        if (changed) {
          await query(
            `UPDATE la_assemblies SET name = ?, district = ?, district_id = ?, required_workers = COALESCE(required_workers, ?) WHERE id = ?`,
            [m.name, m.district_name || null, m.district_id || null, req, cur.id]
          );
        }
        continue;
      }
      // Not yet linked to this master assembly. Adopt a same-named legacy row
      // (location_id NULL) so its existing assessment data attaches to the
      // correct master id without loss — otherwise insert a fresh mirror row.
      const legacy = unlinkedByNorm.get(normDistrict(m.name));
      if (legacy) {
        unlinkedByNorm.delete(normDistrict(m.name));
        linked.set(Number(m.location_id), { ...legacy, location_id: m.location_id });
        await query(
          `UPDATE la_assemblies SET location_id = ?, name = ?, district = ?, district_id = ?, required_workers = COALESCE(required_workers, ?) WHERE id = ?`,
          [m.location_id, m.name, m.district_name || null, m.district_id || null, req, legacy.id]
        );
      } else {
        const res = await query(
          `INSERT INTO la_assemblies (name, district, district_id, required_workers, location_id) VALUES (?, ?, ?, ?, ?)`,
          [m.name, m.district_name || null, m.district_id || null, req, m.location_id]
        );
        linked.set(Number(m.location_id), { id: res.insertId, location_id: m.location_id });
      }
    }
  } catch (e) {
    console.error("[LA] syncAssemblies:", e?.message || e);
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

// A candidate's assessment is COMPLETE only when ALL 10 parameters carry a valid
// score (present and > 0 — 0/blank/null means "not yet scored"). A partial
// assessment, or a record that merely exists, is NOT complete. This is the ONE
// definition used everywhere (candidate list, overview, full view, rankings) so
// the status can never disagree between surfaces or the DB. Computing it live
// from the actual scores also means it flips back to incomplete automatically if
// an edit clears a parameter — no stored flag to drift out of sync.
export function assessmentComplete(a) {
  if (!a) return false;
  return ASSESSMENT_PARAMS.every((p) => Number(a[p.key]) > 0);
}

// SQL fragment (for `s` = la_candidate_assessments / la_mla_assessments alias):
// TRUE when every one of the 10 parameters is scored (> 0). Reused so the DB
// count and the in-memory helpers apply the SAME completion rule.
export const ASSESSMENT_COMPLETE_SQL = (alias = "s") =>
  ASSESSMENT_PARAMS.map((p) => `COALESCE(${alias}.${p.key}, 0) > 0`).join(" AND ");

// An Assembly is COMPLETED only when it has at least one candidate AND EVERY
// candidate linked to it has a complete 10-parameter assessment. Zero candidates
// → not complete; one incomplete candidate → not complete. Uses the ACTUAL
// candidates present (no hardcoded count). Each candidate may expose either a
// precomputed `assessment_done` boolean or its raw `assessment` scores — both
// resolve through the same assessmentComplete rule, so every surface agrees.
export function assemblyComplete(candidates) {
  const list = candidates || [];
  if (!list.length) return false;
  return list.every((c) =>
    c && c.assessment_done != null ? !!c.assessment_done : assessmentComplete(c?.assessment || c)
  );
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

// Validate a single assessment score. Blank/empty → null ("not yet scored").
// Any provided value must be a whole number from 1 to 10 — non-numeric input,
// NaN, decimals, and out-of-range values (incl. 0) are rejected with a message.
export function normalizeScore(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 10) {
    throw "Each score must be a whole number between 1 and 10.";
  }
  return n;
}

// Validate a community percentage. Blank/empty → null. Any provided value must
// be a number in [0, 100] (decimals allowed); non-numeric or out-of-range input
// is rejected with a message.
export function normalizePercentage(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw "Each community percentage must be a number between 0 and 100.";
  }
  return Math.round(n * 100) / 100; // keep up to 2 decimals
}

// Parse a stored JSON-array text field (reasons/weaknesses/strengths) safely.
export function parseList(txt) {
  if (!txt) return [];
  try { const v = JSON.parse(txt); return Array.isArray(v) ? v : []; } catch { return []; }
}

// Authoritative electorate figures for one assembly — Total Voters, Total
// Polling Stations, Total Booths. NOTHING here is dummy or hardcoded:
//   • Polling Stations / Booths are counted live from the geographic master
//     (`locations`) as the assembly's descendants of that type, at any depth
//     (assembly → ward → polling_station → booth). Every node has a unique id
//     in the tree, so COUNT(DISTINCT id) can never double-count.
//   • Voters come from the admin-entered `la_assemblies.total_voters`; this
//     system has no booth-level voter roll, so that stored figure is the
//     authoritative source for the metric.
// Everything is returned as a real number — 0 (never null) when the assembly is
// not linked to Master Data or the master holds no booths/stations yet. `asm`
// must carry at least { location_id, total_voters }.
export async function assemblyElectorate(asm) {
  const locId = asm?.location_id != null && !isNaN(Number(asm.location_id)) ? Number(asm.location_id) : null;
  const voters = asm?.total_voters != null && !isNaN(Number(asm.total_voters)) ? Number(asm.total_voters) : 0;
  let booths = 0;
  let stations = 0;
  if (locId) {
    try {
      // Recursive descent through the whole subtree under this assembly.
      const rows = await query(
        `WITH RECURSIVE subtree AS (
           SELECT id, type, parent_id FROM locations WHERE id = ?
           UNION ALL
           SELECT l.id, l.type, l.parent_id
             FROM locations l JOIN subtree s ON l.parent_id = s.id
         )
         SELECT
           COUNT(DISTINCT CASE WHEN type = 'booth' THEN id END) AS booths,
           COUNT(DISTINCT CASE WHEN type = 'polling_station' THEN id END) AS stations
         FROM subtree`,
        [locId]
      );
      booths = Number(rows[0]?.booths || 0);
      stations = Number(rows[0]?.stations || 0);
    } catch {
      // Fallback for engines without recursive-CTE support: walk up to three
      // parent levels from each booth/station and check this assembly is an
      // ancestor (covers assembly → ward → polling_station → booth).
      try {
        const rows = await query(
          `SELECT
             COUNT(DISTINCT CASE WHEN x.type = 'booth' THEN x.id END) AS booths,
             COUNT(DISTINCT CASE WHEN x.type = 'polling_station' THEN x.id END) AS stations
           FROM locations x
           LEFT JOIN locations p1 ON p1.id = x.parent_id
           LEFT JOIN locations p2 ON p2.id = p1.parent_id
           WHERE x.type IN ('booth', 'polling_station')
             AND (x.parent_id = ? OR p1.parent_id = ? OR p2.parent_id = ?)`,
          [locId, locId, locId]
        );
        booths = Number(rows[0]?.booths || 0);
        stations = Number(rows[0]?.stations || 0);
      } catch (e) {
        console.error("[LA] assemblyElectorate:", e?.message || e);
      }
    }
  }
  return { total_voters: voters, total_polling_stations: stations, total_booths: booths };
}
