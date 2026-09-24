import { query } from "@/lib/db";

// Schema for the Super-Admin-only Influencer module. One table holds the full
// structured profile; multi-value fields (key activities) are stored as a JSON
// string in a TEXT column. ensureInfluencerSchema() is idempotent (CREATE TABLE
// IF NOT EXISTS) and cached per process, so the create/read paths run no DDL.
let ensured = false;
// Cached snapshot of the columns that actually exist on the `influencers` table.
// The create/update paths build their column list from this so a deployment whose
// DB user could not run the guarded ALTERs (no ALTER privilege) still saves into
// whatever columns DO exist, instead of hard-failing with "Unknown column" on a
// column the migration never added. Invalidated whenever ensureColumn adds one.
let columnCache = null;
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
    // Participation workflow (Pending → Joined / Cancelled). join_date is stamped
    // when a contact turns Joined; cancelled_date + cancellation_remark when it turns
    // Cancelled. Added lazily; the first creation of join_date also normalises any
    // legacy status into the three canonical buckets so the dashboard reconciles
    // (Total = Joined + Pending + Cancelled) without losing any record.
    const hadJoinDate = (await query("SHOW COLUMNS FROM influencers LIKE 'join_date'")).length > 0;
    await ensureColumn("join_date", "DATE NULL");
    await ensureColumn("cancelled_date", "DATE NULL");
    await ensureColumn("cancellation_remark", "TEXT NULL");
    // Restructured profile (Profile Details / Political Journey / Social Activity).
    // Added lazily so existing installs gain them without a manual migration; older
    // free-text columns (political_journey, org_social_activity, key_activities,
    // potential_areas, expected_contribution, potential_remarks, …) are RETAINED so
    // no historical data is lost — the module simply no longer writes them.
    await ensureColumn("age", "INT NULL");
    await ensureColumn("caste", "VARCHAR(120) NULL");
    await ensureColumn("current_party", "VARCHAR(160) NULL");
    await ensureColumn("party_years", "VARCHAR(60) NULL");
    await ensureColumn("political_position", "VARCHAR(200) NULL");
    await ensureColumn("org_position", "VARCHAR(200) NULL");
    await ensureColumn("associated_since", "VARCHAR(60) NULL");
    await ensureColumn("social_media", "VARCHAR(400) NULL");
    await ensureColumn("team_size", "VARCHAR(60) NULL");
    await ensureColumn("social_reach", "TEXT NULL");
    // "Joined By" — links the influencer to an EXISTING Contacts record (by id) via
    // a phone lookup, so the contact's details are referenced live (never copied /
    // duplicated). joined_by_phone keeps the number that was looked up. `remark` is
    // a free multiline note shown below Participation Status.
    await ensureColumn("joined_by_contact_id", "INT NULL");
    await ensureColumn("joined_by_phone", "VARCHAR(30) NULL");
    await ensureColumn("remark", "TEXT NULL");
    // Influencer Rating (1–10). Replaces the old "Influence Assessment"
    // (potential_rating ENUM) in the form. Added lazily; potential_rating is
    // RETAINED so historical values are preserved, though the form no longer writes it.
    await ensureColumn("influencer_rating", "INT NULL");
    if (!hadJoinDate) {
      // One-time migration of pre-existing statuses into Pending / Joined / Cancelled.
      // Names, assemblies, Added By and every other detail are untouched.
      await query(
        `UPDATE influencers
            SET status = CASE
              WHEN status = 'Joined' THEN 'Joined'
              WHEN status IN ('Rejected','Closed','Not Interested','Cancelled') THEN 'Cancelled'
              ELSE 'Pending' END
          WHERE status NOT IN ('Pending','Joined','Cancelled') OR status IS NULL`
      ).catch((e) => console.error("[influencer] status migration:", e?.message || e));
      // Give migrated Joined records a best-effort join date so the list isn't blank.
      await query(`UPDATE influencers SET join_date = DATE(updated_at) WHERE status = 'Joined' AND join_date IS NULL`).catch(() => {});
    }
    // Snapshot the columns that ended up on the table, so the INSERT/UPDATE paths
    // only ever reference real columns (see columnCache above).
    await refreshColumnCache();
    ensured = true;
  } catch (e) {
    console.error("[influencer] ensure schema:", e?.message || e);
  }
}

// Add a column to `influencers` only if it doesn't already exist. A successful
// add invalidates the cached column snapshot so the write paths pick it up.
async function ensureColumn(column, definition) {
  try {
    const rows = await query("SHOW COLUMNS FROM influencers LIKE ?", [column]);
    if (!rows.length) {
      await query(`ALTER TABLE influencers ADD COLUMN \`${column}\` ${definition}`);
      columnCache = null;
    }
  } catch (e) {
    console.error(`[influencer] ensureColumn ${column}:`, e?.message || e);
  }
}

// Re-read the live set of column names from the table.
async function refreshColumnCache() {
  try {
    const rows = await query("SHOW COLUMNS FROM influencers");
    columnCache = new Set(rows.map((r) => r.Field));
  } catch (e) {
    console.error("[influencer] refreshColumnCache:", e?.message || e);
  }
}

// The set of columns that actually exist on `influencers` right now. Used by the
// create/update routes to filter their column list, so a missing (never-migrated)
// column is skipped rather than causing an "Unknown column" 500. Falls back to
// reading the table on demand if the cache hasn't been populated yet.
export async function getInfluencerColumns() {
  if (!columnCache) await refreshColumnCache();
  return columnCache || new Set();
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
// Exactly three participation statuses (§7). "Pending" is the default for a new
// Influencer (§8); "Joined" records a join date; "Cancelled" requires a remark.
export const STATUSES = ["Pending", "Joined", "Cancelled"];
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
  return STATUSES.includes(v) ? v : "Pending";
}
export function normalizeRating(r) {
  const v = String(r || "").trim();
  return POTENTIAL_RATINGS.some((x) => x.value === v) ? v : null;
}
