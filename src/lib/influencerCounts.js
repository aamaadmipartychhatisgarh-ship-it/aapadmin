import { query } from "@/lib/db";
import { ensureInfluencerSchema } from "@/lib/influencerSchema";

// Assembly-wise and overall INFLUENCER counts for the State Overview, from ONE query so they can never disagree.
//
// An Influencer is a row of the `influencers` table (the Influencer module's own record: one row = one influencer, identified by its id -
// there is no soft-delete / inactive flag, the module lists every row). Its Assembly is the row's own `assembly_id` - nothing is taken from
// callers, zones, designations or the free-text assembly_name. The value must name a real assembly (a `locations` row of type 'assembly'):
// an empty value ("no assembly"), or one pointing at a missing / non-assembly location ("invalid assembly"), is reported separately and
// is never counted under any assembly. The single join is many-to-one (location ids are unique) and the count is over DISTINCT influencer
// ids, so a record is never counted twice.
//
// Returns { byAssembly: Map<assembly_id, n>, total, mapped, no_assembly, invalid_assembly, unmapped }.
// Invariants: total = mapped + unmapped, mapped = sum of byAssembly, unmapped = no_assembly + invalid_assembly.
export async function influencerAssemblyCounts() {
  await ensureInfluencerSchema();
  const rows = await query(
    `SELECT i.assembly_id AS assembly_id, (a.id IS NOT NULL) AS valid, COUNT(DISTINCT i.id) AS n
       FROM influencers i
       LEFT JOIN locations a ON a.id = i.assembly_id AND a.type = 'assembly'
      GROUP BY i.assembly_id, valid`
  );
  const byAssembly = new Map();
  let total = 0, mapped = 0, no_assembly = 0, invalid_assembly = 0;
  for (const r of rows) {
    const n = Number(r.n) || 0;
    total += n;
    if (Number(r.valid) === 1) { byAssembly.set(r.assembly_id, (byAssembly.get(r.assembly_id) || 0) + n); mapped += n; }
    else if (r.assembly_id == null || Number(r.assembly_id) === 0) no_assembly += n;
    else invalid_assembly += n;
  }
  return { byAssembly, total, mapped, no_assembly, invalid_assembly, unmapped: no_assembly + invalid_assembly };
}

// The INFLUENCERS behind the "Influencer by Assembly" counts, record by record — for the State Overview PDF export. Same rule as
// influencerAssemblyCounts (one row per influencer id; an Assembly only when assembly_id names a real assembly), so per Assembly the
// number of rows equals that Assembly's bar and with no filter the list equals the overall influencer total. Filters:
//   assemblyId — an assembly id, "none" (no / invalid assembly), or null (all);   search — name, mobile, or Assembly name.
export async function influencerPeopleByAssembly({ assemblyId = null, search = "" } = {}) {
  await ensureInfluencerSchema();
  const where = [];
  const params = [];
  if (assemblyId === "none") where.push("a.id IS NULL");
  else if (assemblyId) { where.push("a.id = ?"); params.push(Number(assemblyId)); }
  const q = String(search || "").trim();
  if (q) {
    const like = `%${q}%`;
    // Mobile matching only for a number search (digits, spaces, +, -): "Worker 012" must not match mobiles containing 012.
    const digits = /^[\d\s+\-()]+$/.test(q) ? q.replace(/\D/g, "") : "";
    where.push(`(i.name LIKE ? OR a.name LIKE ?${digits.length >= 3 ? " OR REGEXP_REPLACE(IFNULL(i.phone,''), '[^0-9]', '') LIKE ?" : ""})`);
    params.push(like, like);
    if (digits.length >= 3) params.push(`%${digits}%`);
  }
  return query(
    `SELECT i.id, i.name, i.phone AS mobile, i.influence_type, i.influence_position, i.potential_rating,
            a.id AS assembly_id, a.name AS assembly_name, COALESCE(d.name, i.district_name) AS district_name
       FROM influencers i
       LEFT JOIN locations a ON a.id = i.assembly_id AND a.type = 'assembly'
       LEFT JOIN locations d ON d.id = a.parent_id AND d.type = 'district'
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY (a.name IS NULL), a.name, i.name, i.id`,
    params
  );
}
