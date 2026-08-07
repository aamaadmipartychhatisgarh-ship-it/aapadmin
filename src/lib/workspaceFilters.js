import { geoFilter } from "@/lib/geoFilter";

// The caller's "Assigned to You" filters — search, geography (Lok Sabha /
// District / Assembly), designation, and Call History. Built in ONE place so
// the queue list (/api/workspace/queue) and Start Next Call (/api/workspace/claim)
// apply EXACTLY the same conditions — the blue card always opens the next
// contact from the same filtered dataset the caller is looking at, never a
// random/unfiltered one.
const CALL_HIST_STATUS = { picked: "Phone Picked", not_picked: "Not Picked", busy: "Busy" };

// f: { search, lok_sabha_id, district_id, assembly_id, designation_id, call_history }
// alias: the contacts table alias used by the caller's query ("c" for the queue,
//        "contacts" for the claim route). Returns { where, params, active }.
export function buildAssignedFilters(f = {}, alias = "c") {
  const a = alias ? `${alias}.` : "";
  const clauses = [];
  const params = [];

  const search = typeof f.search === "string" ? f.search.trim() : "";
  if (search) {
    clauses.push(`(${a}person_name LIKE ? OR ${a}phone_number LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }

  const geo = geoFilter(alias, {
    lok_sabha_id: f.lok_sabha_id,
    district_id: f.district_id,
    assembly_id: f.assembly_id,
  });
  clauses.push(...geo.clauses);
  params.push(...geo.params);

  // Designation multi-select ("none" = no designation set).
  const desigSel = String(f.designation_id || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (desigSel.length) {
    const hasNone = desigSel.includes("none");
    const ids = desigSel.filter((x) => x !== "none");
    const parts = [];
    if (ids.length) { parts.push(`${a}designation_id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
    if (hasNone) parts.push(`${a}designation_id IS NULL`);
    if (parts.length) clauses.push(`(${parts.join(" OR ")})`);
  }

  // Call History — based on the contact's COMPLETE call history. Values come
  // from a fixed whitelist, so the status literal is safe to inline.
  const ch = f.call_history;
  if (ch === "blank") {
    clauses.push(`NOT EXISTS (SELECT 1 FROM calls cx WHERE cx.contact_id = ${a}id)`);
  } else if (CALL_HIST_STATUS[ch]) {
    const nm = CALL_HIST_STATUS[ch].replace(/[^A-Za-z ]/g, "");
    clauses.push(`(SELECT cs.name FROM calls cx JOIN call_statuses cs ON cs.id = cx.status_id
                     WHERE cx.contact_id = ${a}id ORDER BY cx.called_at DESC, cx.id DESC LIMIT 1) = '${nm}'`);
  }

  const active = clauses.length > 0;
  return { where: active ? " AND " + clauses.join(" AND ") : "", params, active };
}
