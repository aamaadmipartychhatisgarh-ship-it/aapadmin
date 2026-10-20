import { query } from "@/lib/db";
import { scopeFilterSync } from "@/lib/permissions";
import { assembliesForPhones } from "@/lib/complaintWorker";
import { phoneKey } from "@/lib/phone";

// The ONE place the complaints list is queried: the same filters, the same
// geographic scope and the same Assembly rule for the on-screen list, its counts and
// the PDF export — so what is exported is exactly what the viewer is allowed to see
// under the filters they chose. `searchParams` is a URLSearchParams.
export async function loadComplaintRows(session, searchParams) {
  const scope = scopeFilterSync(session.user, "c", { cols: ["district_id", "assembly_id"] });
  const statusF = searchParams.get("status");
  const typeF = searchParams.get("type");
  const districtId = searchParams.get("district_id");
  const search = searchParams.get("search");
  const where = [], params = [];
  if (statusF) { where.push("c.status = ?"); params.push(statusF); }
  if (typeF) { where.push("c.type = ?"); params.push(typeF); }
  if (districtId) { where.push("c.district_id = ?"); params.push(districtId); }
  if (search) { where.push("(c.citizen_name LIKE ? OR c.citizen_phone LIKE ? OR la.name LIKE ?)"); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  // complaints table has district_id + assembly_id (no zone_id)
  if (scope.where) { where.push(scope.where.replace(/^AND /, "")); params.push(...scope.params); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await query(
    `SELECT c.*, ld.name AS district_name, la.name AS assembly_name, t.name AS team_name, dg.name AS designation_name,
            TIMESTAMPDIFF(HOUR, c.created_at, NOW()) AS age_hours
       FROM complaints c
       LEFT JOIN locations ld ON ld.id = c.district_id
       LEFT JOIN locations la ON la.id = c.assembly_id
       LEFT JOIN teams t ON t.id = c.assigned_team_id
       LEFT JOIN designations dg ON dg.id = c.designation_id
       ${whereSql}
       ORDER BY FIELD(c.status,'open','in_progress','resolved','closed'), c.created_at DESC`,
    params
  );
  // Assembly: the complaint's own saved Assembly wins. For older complaints that
  // never recorded one, show the Assembly of the Worker behind the mobile number
  // when it is unambiguous (display only — the record is not modified); otherwise
  // leave it empty rather than show anything uncertain.
  const missing = rows.filter((c) => c.assembly_id == null && c.citizen_phone).map((c) => c.citizen_phone);
  const derived = missing.length ? await assembliesForPhones(missing) : new Map();
  for (const c of rows) {
    if (c.assembly_id != null) { c.assembly_source = "saved"; continue; }
    const d = derived.get(phoneKey(c.citizen_phone));
    if (d) { c.assembly_name = d.name; c.assembly_source = "worker"; }
    else c.assembly_source = null;
  }
  return { rows, scope };
}
