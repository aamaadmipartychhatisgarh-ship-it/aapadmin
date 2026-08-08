import { query } from "@/lib/db";

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
  ensured = true;
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
  return [...candidates]
    .map((c) => ({ ...c, total: assessmentTotal(c.assessment) }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const wa = (Number(b.assessment?.s_winning) || 0) - (Number(a.assessment?.s_winning) || 0);
      if (wa !== 0) return wa;
      const pa = (Number(b.assessment?.s_acceptability) || 0) - (Number(a.assessment?.s_acceptability) || 0);
      if (pa !== 0) return pa;
      return a.id - b.id;
    })
    .map((c, i) => ({ ...c, rank: i + 1 }));
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
