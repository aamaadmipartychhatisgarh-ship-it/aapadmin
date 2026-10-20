import { query } from "@/lib/db";

// A contact is DESIGNATED when it holds a designation at any of these five
// organisational levels (the Designation Master's `level`). Such people stay in the
// main contact list when a call SENTIMENT is recorded: a Negative / Opponent /
// Not-a-Supporter sentiment never moves them to Not Interested, and a Wrong Number
// sentiment never moves them to Wrong Number. (Zone is not part of this rule.)
// The sentiment itself is still saved on the call — only the automatic MOVE is
// suppressed — and normal, non-designated contacts behave exactly as before.
export const DISPOSITION_PROTECTED_LEVELS = ["state", "lok_sabha", "district", "assembly", "block"];
const LV = DISPOSITION_PROTECTED_LEVELS.map((l) => `'${l}'`).join(",");

// SQL boolean expression (no leading AND) that is true when contact `alias` holds a
// designation at a protected level — via the multi-designation table OR the legacy
// single contacts.designation_id. Usable inside a WHERE / SET ... WHERE.
export function designatedExistsSql(alias = "c") {
  return `(EXISTS (SELECT 1 FROM contact_designations cdp JOIN designations dp ON dp.id = cdp.designation_id
                    WHERE cdp.contact_id = ${alias}.id AND dp.level IN (${LV}))
        OR EXISTS (SELECT 1 FROM designations dl WHERE dl.id = ${alias}.designation_id AND dl.level IN (${LV})))`;
}

// Single-contact check used by every backend workflow that could move a contact on a
// sentiment change. Tolerates deployments without the optional tables/columns.
export async function isDesignatedContact(contactId) {
  const id = Number(contactId);
  if (!Number.isInteger(id) || id <= 0) return false;
  try {
    const [a] = await query(
      `SELECT 1 AS x FROM contact_designations cdp JOIN designations dp ON dp.id = cdp.designation_id
        WHERE cdp.contact_id = ? AND dp.level IN (${LV}) LIMIT 1`, [id]
    ).catch(() => []);
    if (a) return true;
    const [b] = await query(
      `SELECT 1 AS x FROM contacts c JOIN designations dl ON dl.id = c.designation_id
        WHERE c.id = ? AND dl.level IN (${LV}) LIMIT 1`, [id]
    ).catch(() => []);
    return !!b;
  } catch {
    return false;
  }
}
