import { query } from "@/lib/db";

// Automatic, DERIVED classification of contacts that have been dispositioned
// "Switched Off" or "Incoming Off" more than 10 times — counted from the ACTUAL
// call records (calls joined to call_statuses), never a manual counter. Because
// it is derived, editing/deleting/correcting a call recomputes it instantly with
// no stored flag to keep in sync (§4, §7, §8).
//
//   count(status) > 10  →  the contact drops OUT of the main Contacts list/count
//                          and INTO the matching "10+ Times …" page.
//
// The two statuses are independent (§5): a contact can be in one, both, or
// neither. Nothing is ever deleted (§11) and no duplicate contact rows exist —
// membership is purely a function of the call history.

export const REPEAT_OFF_THRESHOLD = 10; // "more than 10" → strictly > 10 (11th qualifies)
export const REPEAT_OFF_STATUSES = { switched: "Switched Off", incoming: "Incoming Off" };

let ensured = false;
let idCache = null;

// "Incoming Off" is a real call disposition (added here). Seeding it into
// call_statuses makes it selectable everywhere the status dropdown is loaded
// from /api/statuses — no per-screen UI change needed. Also add a composite
// index so the per-contact count subqueries stay cheap on a large calls table.
export async function ensureRepeatOffSchema() {
  if (ensured) return;
  try {
    await query(`INSERT IGNORE INTO call_statuses (name) VALUES ('Incoming Off')`);
    try {
      const idx = await query(
        `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calls' AND INDEX_NAME = 'idx_calls_contact_status'`
      );
      if (Number(idx[0]?.n || 0) === 0) {
        await query(`ALTER TABLE calls ADD INDEX idx_calls_contact_status (contact_id, status_id)`);
      }
    } catch (e) { console.error("[repeatOff] index:", e?.message || e); }
    ensured = true;
  } catch (e) {
    console.error("[repeatOff] ensure:", e?.message || e);
  }
}

async function statusIds() {
  if (idCache) return idCache;
  await ensureRepeatOffSchema();
  const rows = await query(
    `SELECT id, name FROM call_statuses WHERE name IN (?, ?)`,
    [REPEAT_OFF_STATUSES.switched, REPEAT_OFF_STATUSES.incoming]
  );
  const by = {};
  for (const r of rows) by[r.name] = Number(r.id);
  idCache = { switched: by[REPEAT_OFF_STATUSES.switched] || null, incoming: by[REPEAT_OFF_STATUSES.incoming] || null };
  return idCache;
}

// Count of a contact's calls with one status id — a correlated subquery keyed on
// the indexed calls.contact_id. statusId is a validated integer, so interpolating
// it is injection-safe.
function countExpr(alias, statusId) {
  return `(SELECT COUNT(*) FROM calls cx WHERE cx.contact_id = ${alias}.id AND cx.status_id = ${Number(statusId)})`;
}

// AND clause for the MAIN contacts list/count/export: keep only contacts at or
// below the threshold on BOTH statuses (i.e. exclude anyone over on either).
export async function repeatOffExclusion(alias = "c") {
  const { switched, incoming } = await statusIds();
  const parts = [];
  if (switched) parts.push(`${countExpr(alias, switched)} <= ${REPEAT_OFF_THRESHOLD}`);
  if (incoming) parts.push(`${countExpr(alias, incoming)} <= ${REPEAT_OFF_THRESHOLD}`);
  return parts.length ? " AND " + parts.join(" AND ") : "";
}

// For a "10+ Times …" page: the WHERE fragment selecting contacts OVER the
// threshold for ONE status, plus the count expression to display.
export async function repeatOffSelect(type, alias = "c") {
  const { switched, incoming } = await statusIds();
  const id = type === "incoming" ? incoming : switched;
  if (!id) return { where: " AND 1=0", countExpr: "0" };
  return { where: ` AND ${countExpr(alias, id)} > ${REPEAT_OFF_THRESHOLD}`, countExpr: countExpr(alias, id) };
}
