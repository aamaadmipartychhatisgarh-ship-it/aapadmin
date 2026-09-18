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
// Parameterized by the column so the SAME canonical mapping identifies the party of
// the Current MLA, of each competitor (mp.party / mp.competitorN_party), and of an
// election-history row (e.party) — one rule, never divergent name matching.
const aapMatch = (c) => `(UPPER(TRIM(${c})) = 'AAP' OR LOWER(${c}) LIKE '%aam aadmi%' OR ${c} LIKE '%आम आदमी%')`;
const bjpMatch = (c) => `(UPPER(TRIM(${c})) = 'BJP' OR LOWER(${c}) LIKE '%bharatiya janata%' OR ${c} LIKE '%भारतीय जनता%')`;
const incMatch = (c) => `(UPPER(TRIM(${c})) IN ('INC', 'CONGRESS') OR LOWER(${c}) LIKE '%indian national congress%' OR LOWER(${c}) LIKE '%congress%' OR ${c} LIKE '%कांग्रेस%')`;
const AAP_MATCH_SQL = aapMatch("e.party"); // still used to pick the AAP candidate column

// JS mirrors of the SAME canonical party matchers — used to compute per-assembly
// party totals + winner/runner-up in the backend (per row, before pagination), so
// the Comparison list can show each assembly's AAP/BJP/Congress totals, the
// AAP-vs-BJP and BJP-vs-Congress differences, and the winning margin without a
// second competing calculation and without being affected by which rows are on
// the current page. One rule, never divergent from the SQL matchers above.
const jsAap = (p) => { const s = String(p ?? "").trim(); return s.toLowerCase() === "aap" || s.toLowerCase().includes("aam aadmi") || s.includes("आम आदमी"); };
const jsBjp = (p) => { const s = String(p ?? "").trim(); return s.toLowerCase() === "bjp" || s.toLowerCase().includes("bharatiya janata") || s.includes("भारतीय जनता"); };
const jsInc = (p) => { const s = String(p ?? "").trim(); const u = s.toUpperCase(); const l = s.toLowerCase(); return u === "INC" || u === "CONGRESS" || l.includes("indian national congress") || l.includes("congress") || s.includes("कांग्रेस"); };

// Per-assembly vote analytics from the assembly's OWN candidates (Current MLA +
// Competitor 1/2/3). `people` is [{ name, party, votes }]. Party totals credit each
// person to their ACTUAL stored party (never position, never "Competitor 3 = AAP");
// a party with no candidate in this assembly stays null (unavailable), never a
// fabricated 0. Winner/runner-up are the two highest vote-getters (standard ECI
// margin = winner − runner-up); a top-two equality is a genuine tie, not an
// arbitrarily-picked winner. Everything is scoped to this one assembly's people.
function assemblyVoteStats(people) {
  const withVotes = people.filter((p) => p.votes != null && Number.isFinite(Number(p.votes)));
  const partyTotal = (match) => {
    const m = withVotes.filter((p) => p.party && match(p.party));
    if (!m.length) return null;
    return m.reduce((s, p) => s + Number(p.votes), 0);
  };
  const aap = partyTotal(jsAap), bjp = partyTotal(jsBjp), inc = partyTotal(jsInc);
  const sorted = [...withVotes].sort((a, b) => Number(b.votes) - Number(a.votes));
  let winner = null, runner_up_votes = null, winning_margin = null, winner_tie = false;
  if (sorted.length >= 1) winner = { name: sorted[0].name || null, party: sorted[0].party || null, votes: Number(sorted[0].votes) };
  if (sorted.length >= 2) {
    runner_up_votes = Number(sorted[1].votes);
    winning_margin = Number(sorted[0].votes) - Number(sorted[1].votes);
    winner_tie = winning_margin === 0;
  }
  return {
    aap_total: aap,
    bjp_total: bjp,
    inc_total: inc,
    aap_bjp_diff: (aap != null && bjp != null) ? Math.abs(aap - bjp) : null,
    bjp_inc_diff: (bjp != null && inc != null) ? Math.abs(bjp - inc) : null,
    winner,                 // { name, party, votes } | null
    runner_up_votes,        // number | null
    winning_margin,         // number | null (null = insufficient data)
    winner_tie,             // true → genuine top-two tie
  };
}

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
        mp.photo_url    AS mla_photo_url,
        mp.mla_votes    AS mla_votes,
        mp.competitor1_name  AS competitor1_name,
        mp.competitor1_party AS competitor1_party,
        mp.competitor1_votes AS competitor1_votes,
        mp.competitor2_name  AS competitor2_name,
        mp.competitor2_party AS competitor2_party,
        mp.competitor2_votes AS competitor2_votes,
        mp.competitor3_name  AS competitor3_name,
        mp.competitor3_party AS competitor3_party,
        mp.competitor3_votes AS competitor3_votes,
        mp.competitor_margin AS competitor_margin
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
    const c1 = (r.competitor1_name && String(r.competitor1_name).trim()) ? r.competitor1_name : null;
    const c2 = (r.competitor2_name && String(r.competitor2_name).trim()) ? r.competitor2_name : null;
    const c3 = (r.competitor3_name && String(r.competitor3_name).trim()) ? r.competitor3_name : null;
    // Per-assembly analytics from THIS assembly's own four candidates only.
    const stats = assemblyVoteStats([
      { name: mlaName, party: r.mla_party || null, votes: mlaVotes },
      { name: c1, party: r.competitor1_party || null, votes: r.competitor1_votes ?? null },
      { name: c2, party: r.competitor2_party || null, votes: r.competitor2_votes ?? null },
      { name: c3, party: r.competitor3_party || null, votes: r.competitor3_votes ?? null },
    ]);
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
      mla_photo_url: r.mla_photo_url || null,
      mla_votes: mlaVotes,
      // The three competitors from the MLA Profile (the same source as the MLA
      // Profile view — each person credited to their OWN stored party/votes, never
      // position-shifted, never assumed to be AAP). Surfaced so the Comparison page
      // can show Current MLA + Competitor 1/2/3 directly, no popup needed.
      competitor1_name: (r.competitor1_name && String(r.competitor1_name).trim()) ? r.competitor1_name : null,
      competitor1_party: r.competitor1_party || null,
      competitor1_votes: r.competitor1_votes ?? null,
      competitor2_name: (r.competitor2_name && String(r.competitor2_name).trim()) ? r.competitor2_name : null,
      competitor2_party: r.competitor2_party || null,
      competitor2_votes: r.competitor2_votes ?? null,
      competitor3_name: (r.competitor3_name && String(r.competitor3_name).trim()) ? r.competitor3_name : null,
      competitor3_party: r.competitor3_party || null,
      competitor3_votes: r.competitor3_votes ?? null,
      competitor_margin: r.competitor_margin ?? null,
      // Per-assembly vote analytics (party totals, AAP-vs-BJP & BJP-vs-Congress
      // differences, winner / runner-up / winning margin) computed above from this
      // assembly's own candidates — see assemblyVoteStats.
      vote_stats: stats,
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

// PARTY-WISE VOTE TOTALS for the summary cards (BJP / INC / AAP), computed from
// the SOURCE OF TRUTH — the MLA Profile of every filtered assembly. For each
// assembly the profile carries FOUR people with a party and a vote count:
//   • the Current MLA               (mp.party            / mp.mla_votes)
//   • Competitor 1 / 2 / 3          (mp.competitorN_party / mp.competitorN_votes)
// Each person's votes are added to THEIR OWN party's total (party read via the
// same canonical matcher, not position — so a competitor is credited to whatever
// party is actually stored for them, and the Current MLA's votes ARE included in
// their party). Every one of the four vote fields is summed EXACTLY ONCE, so
// there is no double counting, and the whole filtered dataset is aggregated in
// the database — never a paginated subset. Also returns the AAP-vs-BJP margin.
export async function fetchComparisonPartyTotals(filters = {}) {
  const { where: geoWhere, params: geoParams } = geoFilter(filters);
  const whereSql = geoWhere.length ? `AND ${geoWhere.join(" AND ")}` : "";

  // The four (party column, votes column) pairs a profile contributes.
  const PEOPLE = [
    ["mp.party", "mp.mla_votes"],
    ["mp.competitor1_party", "mp.competitor1_votes"],
    ["mp.competitor2_party", "mp.competitor2_votes"],
    ["mp.competitor3_party", "mp.competitor3_votes"],
  ];
  // Sum of every person's votes whose party matches, each counted once.
  const partySum = (match) =>
    `COALESCE(SUM(${PEOPLE.map(([p, v]) => `CASE WHEN ${match(p)} THEN COALESCE(${v}, 0) ELSE 0 END`).join(" + ")}), 0)`;

  const [row] = await query(
    `SELECT
        ${partySum(bjpMatch)} AS bjp_total,
        ${partySum(incMatch)} AS inc_total,
        ${partySum(aapMatch)} AS aap_total
       FROM la_mla_profiles mp
       JOIN la_assemblies a  ON a.id = mp.assembly_id
       JOIN locations al  ON al.id = a.location_id AND al.type = 'assembly'
       LEFT JOIN locations dl  ON dl.id  = al.parent_id  AND dl.type  = 'district'
       LEFT JOIN locations lsl ON lsl.id = dl.parent_id  AND lsl.type = 'lok_sabha'
       LEFT JOIN locations zl  ON zl.id  = lsl.parent_id AND zl.type  = 'zone'
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
