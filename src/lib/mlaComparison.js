import { query } from "@/lib/db";

// ---------------------------------------------------------------------------
// Current MLA vs AAP Candidate — VOTE comparison (single source of truth).
//
// This is the ONE place the comparison dataset is built. The Comparison UI, the
// Excel export and the PDF export all call `fetchComparisonDataset` with the SAME
// filters, so the screen and both exports can never disagree (spec §14). It
// carries NO assessment scores / strengths / rankings — purely vote counts
// (spec §1, §17).
//
// Data sources (spec §5, §6 — decided with the product owner):
//   • Current MLA name + votes  → la_mla_profiles (name, mla_votes) — the
//     admin-entered authority, one row per assembly (UNIQUE assembly_id), always
//     the latest saved profile (§5, no cache).
//   • AAP candidate + votes     → the assembly's Election History
//     (la_mla_elections): the row whose party is AAP, taken from the SAME election
//     year as the current MLA — i.e. the assembly's most recent election year
//     (§15, never mixing elections). If AAP did not contest that year, the AAP
//     votes are Not Available (§7) rather than a fabricated 0.
//
// Everything is keyed by the authoritative assembly id (la_assemblies.id, linked
// to Master Data via location_id) — never by name — so a candidate can never be
// mapped to the wrong assembly (spec §4).
// ---------------------------------------------------------------------------

// Party matchers against the free-text party name (there is no party flag; parties
// are stored by their Party-Master name). Each covers the common English + Hindi
// forms, case-insensitively, so the stored name resolves regardless of exact form.
const AAP_MATCH_SQL = `(
  UPPER(TRIM(e.party)) = 'AAP'
  OR LOWER(e.party) LIKE '%aam aadmi%'
  OR e.party LIKE '%आम आदमी%'
)`;
const BJP_MATCH_SQL = `(
  UPPER(TRIM(e.party)) = 'BJP'
  OR LOWER(e.party) LIKE '%bharatiya janata%'
  OR e.party LIKE '%भारतीय जनता%'
)`;
const INC_MATCH_SQL = `(
  UPPER(TRIM(e.party)) IN ('INC', 'CONGRESS')
  OR LOWER(e.party) LIKE '%indian national congress%'
  OR LOWER(e.party) LIKE '%congress%'
  OR e.party LIKE '%कांग्रेस%'
)`;

// Normalize a filter value (single id, array of ids, or comma-separated string)
// to an array of positive integers.
function toIdList(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : String(v).split(",");
  return arr.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
}

// Build a { where, params } geo filter on the assembly's master location chain.
// Any subset of the four levels may be given, and each level accepts MULTIPLE ids
// (the filter UI is multi-select) — each narrows the set with an IN clause. All
// ids are the authoritative `locations` ids (zone/lok_sabha/district/assembly),
// the same source the rest of the app filters by.
function geoFilter({ zone_id, lok_sabha_id, district_id, assembly_id }) {
  const where = [];
  const params = [];
  const add = (col, vals) => {
    const ids = toIdList(vals);
    if (ids.length) { where.push(`${col} IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  };
  add("zl.id", zone_id);
  add("lsl.id", lok_sabha_id);
  add("dl.id", district_id);
  add("al.id", assembly_id);
  return { where, params };
}

// Compute the vote difference + who leads for one row, honoring "Not Available"
// (spec §3, §7). Returns { difference, leader } where difference is null (shown as
// "—") whenever either vote value is missing — a missing value is NEVER treated
// as 0.
export function compareVotes(mlaVotes, aapVotes) {
  const hasMla = mlaVotes != null && mlaVotes !== "";
  const hasAap = aapVotes != null && aapVotes !== "";
  if (!hasMla || !hasAap) return { difference: null, leader: null };
  const m = Number(mlaVotes);
  const a = Number(aapVotes);
  const difference = Math.abs(m - a);
  let leader;
  if (m > a) leader = "Current MLA";
  else if (a > m) leader = "AAP Candidate";
  else leader = "Equal";
  return { difference, leader };
}

// Fetch the COMPLETE filtered comparison dataset (no pagination — pagination is
// applied by the caller AFTER this, and never affects totals/exports, spec §13).
// One row per master-linked assembly.
export async function fetchComparisonDataset(filters = {}) {
  const { where: geoWhere, params: geoParams } = geoFilter(filters);
  const whereSql = geoWhere.length ? `AND ${geoWhere.join(" AND ")}` : "";

  // Assemblies + current MLA + full geography (for filters + display). INNER JOIN
  // to the master assembly location so only real master assemblies are listed
  // (mirrors the MLA-list route); the MLA profile is LEFT so an assembly with no
  // MLA record still appears with "Not Available".
  const rows = await query(
    `SELECT
        a.id            AS assembly_id,
        a.location_id   AS assembly_loc_id,
        al.name         AS assembly_name,
        zl.id           AS zone_id,          zl.name  AS zone_name,
        lsl.id          AS lok_sabha_id,     lsl.name AS lok_sabha_name,
        dl.id           AS district_id,      dl.name  AS district_name,
        mp.name         AS mla_name,
        mp.party        AS mla_party,
        mp.mla_votes    AS mla_votes
       FROM la_assemblies a
       JOIN locations al  ON al.id = a.location_id AND al.type = 'assembly'
       LEFT JOIN locations dl  ON dl.id  = al.parent_id  AND dl.type  = 'district'
       LEFT JOIN locations lsl ON lsl.id = dl.parent_id  AND lsl.type = 'lok_sabha'
       LEFT JOIN locations zl  ON zl.id  = lsl.parent_id AND zl.type  = 'zone'
       LEFT JOIN la_mla_profiles mp ON mp.assembly_id = a.id
      WHERE a.location_id IS NOT NULL
        ${whereSql}
      ORDER BY al.name ASC`,
    geoParams
  );

  // AAP candidate + votes per assembly, anchored to each assembly's MOST RECENT
  // election year (so the AAP figure is from the SAME election as the sitting
  // MLA — spec §15). Within that year, the AAP row with the most votes wins
  // (NULL votes sort last under DESC). We fetch all matching rows and pick the
  // first per assembly in JS — the dataset is small (one election per assembly).
  const aapRows = await query(
    `SELECT e.assembly_id, e.candidate, e.votes, e.election_year
       FROM la_mla_elections e
       JOIN (
         SELECT assembly_id, MAX(election_year) AS yr
           FROM la_mla_elections
          WHERE election_year IS NOT NULL
          GROUP BY assembly_id
       ) latest ON latest.assembly_id = e.assembly_id AND e.election_year = latest.yr
      WHERE ${AAP_MATCH_SQL}
      ORDER BY e.assembly_id ASC, e.votes DESC`
  );
  const aapByAssembly = new Map();
  for (const r of aapRows) {
    if (!aapByAssembly.has(r.assembly_id)) aapByAssembly.set(r.assembly_id, r);
  }

  return rows.map((r) => {
    const aap = aapByAssembly.get(r.assembly_id) || null;
    const mlaName = r.mla_name && String(r.mla_name).trim() ? r.mla_name : null;
    const mlaVotes = r.mla_votes ?? null;
    const aapCandidate = aap?.candidate && String(aap.candidate).trim() ? aap.candidate : null;
    const aapVotes = aap?.votes ?? null;
    const { difference, leader } = compareVotes(mlaVotes, aapVotes);
    return {
      assembly_id: r.assembly_id,
      assembly_loc_id: r.assembly_loc_id,
      assembly_name: r.assembly_name || null,
      zone_id: r.zone_id || null,
      zone_name: r.zone_name || null,
      lok_sabha_id: r.lok_sabha_id || null,
      lok_sabha_name: r.lok_sabha_name || null,
      district_id: r.district_id || null,
      district_name: r.district_name || null,
      mla_name: mlaName,
      mla_party: r.mla_party || null,
      mla_votes: mlaVotes,
      aap_candidate: aapCandidate,
      aap_votes: aapVotes,
      election_year: aap?.election_year ?? null,
      difference,   // null → shown as "—" (missing vote data, spec §7)
      leader,       // "Current MLA" | "AAP Candidate" | "Equal" | null
    };
  });
}

// Summary cards — computed from the SAME dataset shown in the table, so they
// always agree with it. "Complete" means both vote values are present.
export function comparisonSummary(rows) {
  let complete = 0, mlaMore = 0, aapMore = 0, equal = 0;
  for (const r of rows) {
    if (r.mla_votes == null || r.aap_votes == null) continue;
    complete++;
    if (r.leader === "Current MLA") mlaMore++;
    else if (r.leader === "AAP Candidate") aapMore++;
    else if (r.leader === "Equal") equal++;
  }
  return {
    total_assemblies: rows.length,
    complete_data: complete,
    mla_more: mlaMore,
    aap_more: aapMore,
    equal_votes: equal,
  };
}

// PARTY-WISE VOTE TOTALS for the summary cards (BJP / INC / AAP). For every
// master assembly in the current filter scope, we take that assembly's MOST
// RECENT election year (the applicable election — same anchor the AAP column
// uses) and SUM the votes of EVERY row of each party in that year (so multiple
// candidate records of the same party are all counted, never just one), then add
// those sums across all filtered assemblies. Read live from la_mla_elections, so
// the totals update whenever the source vote data changes. Also returns the
// AAP-vs-BJP margin and who leads.
export async function fetchComparisonPartyTotals(filters = {}) {
  const { where: geoWhere, params: geoParams } = geoFilter(filters);
  const whereSql = geoWhere.length ? `AND ${geoWhere.join(" AND ")}` : "";

  const [row] = await query(
    `SELECT
        COALESCE(SUM(CASE WHEN ${BJP_MATCH_SQL} THEN e.votes ELSE 0 END), 0) AS bjp_total,
        COALESCE(SUM(CASE WHEN ${INC_MATCH_SQL} THEN e.votes ELSE 0 END), 0) AS inc_total,
        COALESCE(SUM(CASE WHEN ${AAP_MATCH_SQL} THEN e.votes ELSE 0 END), 0) AS aap_total
       FROM la_mla_elections e
       JOIN la_assemblies a  ON a.id = e.assembly_id
       JOIN locations al  ON al.id = a.location_id AND al.type = 'assembly'
       LEFT JOIN locations dl  ON dl.id  = al.parent_id  AND dl.type  = 'district'
       LEFT JOIN locations lsl ON lsl.id = dl.parent_id  AND lsl.type = 'lok_sabha'
       LEFT JOIN locations zl  ON zl.id  = lsl.parent_id AND zl.type  = 'zone'
       JOIN (
         SELECT assembly_id, MAX(election_year) AS yr
           FROM la_mla_elections
          WHERE election_year IS NOT NULL
          GROUP BY assembly_id
       ) latest ON latest.assembly_id = e.assembly_id AND e.election_year = latest.yr
      WHERE a.location_id IS NOT NULL
        ${whereSql}`,
    geoParams
  );

  const bjp = Number(row?.bjp_total || 0);
  const inc = Number(row?.inc_total || 0);
  const aap = Number(row?.aap_total || 0);
  const margin = Math.abs(bjp - aap);
  const margin_leader = bjp > aap ? "BJP" : aap > bjp ? "AAP" : "Equal";
  return { bjp_total: bjp, inc_total: inc, aap_total: aap, aap_bjp_margin: margin, margin_leader };
}
