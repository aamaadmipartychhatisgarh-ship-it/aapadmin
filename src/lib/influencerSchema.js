import { query } from "@/lib/db";

// Schema for the Super-Admin-only Influencer module. One table holds the full
// structured profile; multi-value fields (key activities) are stored as a JSON
// string in a TEXT column. ensureInfluencerSchema() is idempotent (CREATE TABLE
// IF NOT EXISTS) and cached per process, so the create/read paths run no DDL.
let ensured = false;
export async function ensureInfluencerSchema() {
  if (ensured) return;
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS influencers (
         id INT AUTO_INCREMENT PRIMARY KEY,
         name VARCHAR(150) NOT NULL,
         phone VARCHAR(30) NULL,
         photo_url VARCHAR(512) NULL,
         address TEXT NULL,
         assembly_id INT NULL,
         assembly_name VARCHAR(160) NULL,
         district_id INT NULL,
         district_name VARCHAR(160) NULL,
         lok_sabha_id INT NULL,
         lok_sabha_name VARCHAR(160) NULL,
         zone_id INT NULL,
         zone_name VARCHAR(160) NULL,
         influence_type VARCHAR(80) NULL,
         influence_position TEXT NULL,
         key_activities TEXT NULL,
         political_journey TEXT NULL,
         contested_election TINYINT NOT NULL DEFAULT 0,
         election_type VARCHAR(120) NULL,
         election_year VARCHAR(12) NULL,
         election_constituency VARCHAR(160) NULL,
         election_party VARCHAR(120) NULL,
         election_position VARCHAR(120) NULL,
         election_result VARCHAR(120) NULL,
         election_votes VARCHAR(60) NULL,
         election_details TEXT NULL,
         org_social_activity TEXT NULL,
         economic_status VARCHAR(80) NULL,
         economic_profile TEXT NULL,
         potential_rating ENUM('very_high','high','medium','low','very_low') NULL,
         potential_areas TEXT NULL,
         expected_contribution TEXT NULL,
         potential_remarks TEXT NULL,
         status VARCHAR(40) NOT NULL DEFAULT 'new',
         next_action VARCHAR(80) NULL,
         action_remarks TEXT NULL,
         follow_up_date DATE NULL,
         responsible_person VARCHAR(160) NULL,
         created_by INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         KEY idx_status (status),
         KEY idx_assembly (assembly_id),
         KEY idx_name (name),
         KEY idx_potential (potential_rating)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    // Existing installs: add the newer columns if the table pre-dates them
    // (guarded ALTERs — never touch/lose existing data).
    await ensureColumn("photo_url", "VARCHAR(512) NULL");
    await ensureColumn("district_id", "INT NULL");
    await ensureColumn("district_name", "VARCHAR(160) NULL");
    await ensureColumn("lok_sabha_id", "INT NULL");
    await ensureColumn("lok_sabha_name", "VARCHAR(160) NULL");
    await ensureColumn("zone_id", "INT NULL");
    await ensureColumn("zone_name", "VARCHAR(160) NULL");
    ensured = true;
  } catch (e) {
    console.error("[influencer] ensure schema:", e?.message || e);
  }
}

// Add a column to `influencers` only if it doesn't already exist.
async function ensureColumn(column, definition) {
  try {
    const rows = await query("SHOW COLUMNS FROM influencers LIKE ?", [column]);
    if (!rows.length) await query(`ALTER TABLE influencers ADD COLUMN \`${column}\` ${definition}`);
  } catch (e) {
    console.error(`[influencer] ensureColumn ${column}:`, e?.message || e);
  }
}

// Resolve an assembly's full location chain from master data (DB-driven):
//   assembly → district → lok_sabha → zone (via locations.parent_id).
// Returns ids + names, with nulls where the mapping is incomplete (never throws).
export async function resolveAssemblyHierarchy(assemblyId) {
  const empty = {
    assembly_id: null, assembly_name: null, district_id: null, district_name: null,
    lok_sabha_id: null, lok_sabha_name: null, zone_id: null, zone_name: null,
  };
  if (assemblyId == null || String(assemblyId).trim() === "") return empty;
  try {
    const [row] = await query(
      `SELECT a.id AS assembly_id, a.name AS assembly_name,
              d.id AS district_id, d.name AS district_name,
              l.id AS lok_sabha_id, l.name AS lok_sabha_name,
              z.id AS zone_id, z.name AS zone_name
         FROM locations a
         LEFT JOIN locations d ON d.id = a.parent_id AND d.type = 'district'
         LEFT JOIN locations l ON l.id = d.parent_id AND l.type = 'lok_sabha'
         LEFT JOIN locations z ON z.id = l.parent_id AND z.type = 'zone'
        WHERE a.id = ? AND a.type = 'assembly'`,
      [assemblyId]
    );
    return row || empty;
  } catch (e) {
    console.error("[influencer] resolveAssemblyHierarchy:", e?.message || e);
    return empty;
  }
}

// Canonical option sets — kept server-side so the API can validate and the UI
// can render the same lists (fetched via GET ?meta=1).
export const INFLUENCE_TYPES = [
  "Strong local influence", "Community influence", "Social influence", "Political influence",
  "Organization influence", "Youth influence", "Business influence", "Caste/community influence",
  "Religious/social influence", "Digital/social-media influence", "Village/block-level influence",
  "Assembly-level influence",
];
export const POTENTIAL_RATINGS = [
  { value: "very_high", label: "Very High" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "very_low", label: "Very Low" },
];
export const STATUSES = [
  "New", "Under Assessment", "Shortlisted", "Contact Required", "Contacted",
  "Meeting Required", "Meeting Scheduled", "In Discussion", "Interested",
  "Not Interested", "Joined", "On Hold", "Rejected", "Closed",
];
export const NEXT_ACTIONS = [
  "Call Influencer", "Arrange Meeting", "Contact Through Reference", "Conduct Background Assessment",
  "Follow Up", "Arrange Senior Leadership Meeting", "Discuss Party Joining", "Hold for Future",
  "No Further Action",
];
export const ECONOMIC_STATUSES = ["High", "Upper Middle", "Middle", "Lower Middle", "Modest", "Not Known"];

// Normalize a status/rating key for storage. Status is stored as the label text
// (free-ish but validated against the list); rating is stored as its enum value.
export function normalizeStatus(s) {
  const v = String(s || "").trim();
  return STATUSES.includes(v) ? v : "New";
}
export function normalizeRating(r) {
  const v = String(r || "").trim();
  return POTENTIAL_RATINGS.some((x) => x.value === v) ? v : null;
}
