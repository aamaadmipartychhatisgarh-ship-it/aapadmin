// Shared helpers for standing assignment rules ("daily beats").
//
// A rule matches a slice of contacts by designation(s) + geography, mirroring
// the Contacts page filters. buildRuleMatch() turns a rule row into the SQL
// predicate (AND …) that selects the contacts it targets, so the top-up and
// the preview count stay in lockstep.

import { query } from "@/lib/db";

// Whether contacts.assigned_at exists yet (added by add-assignment-rules-schema).
// Cached so we don't hit information_schema on every assignment.
let assignedAtPromise;
export async function contactsHaveAssignedAt() {
  if (!assignedAtPromise) {
    assignedAtPromise = query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts' AND COLUMN_NAME = 'assigned_at'`
    ).then((r) => Number(r[0]?.n || 0) > 0).catch(() => { assignedAtPromise = undefined; return false; });
  }
  return assignedAtPromise;
}

export function parseIds(csv) {
  if (!csv) return [];
  return [...new Set(String(csv).split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0))];
}

// Constrain contacts to a caller's home zone: districts directly under the
// zone, or under a lok_sabha under the zone. Returns { where, params } (an
// AND-fragment) or an empty match when no zone is set.
export function zoneMatch(zoneId, alias = "c") {
  if (!zoneId) return { where: "", params: [] };
  const c = alias ? `${alias}.` : "";
  return {
    where: ` AND ${c}district_id IN (
      SELECT d.id FROM locations d WHERE d.type = 'district'
        AND (d.parent_id = ?
             OR d.parent_id IN (SELECT ls.id FROM locations ls WHERE ls.type = 'lok_sabha' AND ls.parent_id = ?)))`,
    params: [zoneId, zoneId],
  };
}

// Combine several rules into one boolean expression: a contact is "daily" if it
// matches ANY of them. Returns { sql, params } where sql is `(...) OR (...)`
// (or "0" when there are no rules). A rule with no filters matches everything.
export function buildRulesOrMatch(rules, alias = "c") {
  const groups = [];
  const params = [];
  for (const r of rules) {
    const m = buildRuleMatch(r, alias);
    const inner = m.where.trim().replace(/^AND\s+/, "");
    groups.push(inner ? `(${inner})` : "(1=1)");
    params.push(...m.params);
  }
  if (groups.length === 0) return { sql: "0", params: [] };
  return { sql: groups.join(" OR "), params };
}

// Returns { where, params } — a chunk of AND conditions against contacts alias `c`.
export function buildRuleMatch(rule, alias = "c") {
  const c = `${alias}.`;
  let where = "";
  const params = [];

  const desig = parseIds(rule.designation_ids);
  if (desig.length) {
    where += ` AND ${c}designation_id IN (${desig.map(() => "?").join(",")})`;
    params.push(...desig);
  }
  if (rule.zone_id) {
    // districts directly under the zone, or under a lok_sabha under the zone
    where += ` AND ${c}district_id IN (
      SELECT d.id FROM locations d WHERE d.type = 'district'
        AND (d.parent_id = ?
             OR d.parent_id IN (SELECT ls.id FROM locations ls WHERE ls.type = 'lok_sabha' AND ls.parent_id = ?)))`;
    params.push(rule.zone_id, rule.zone_id);
  }
  if (rule.lok_sabha_id) {
    where += ` AND ${c}district_id IN (SELECT id FROM locations WHERE type = 'district' AND parent_id = ?)`;
    params.push(rule.lok_sabha_id);
  }
  if (rule.district_id) { where += ` AND ${c}district_id = ?`; params.push(rule.district_id); }
  if (rule.assembly_id) { where += ` AND ${c}assembly_id = ?`; params.push(rule.assembly_id); }

  return { where, params };
}
