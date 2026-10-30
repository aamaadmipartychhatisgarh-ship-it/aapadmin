import { query } from "@/lib/db";

// The call row stores a SNAPSHOT of the contact's name / phone / address, in columns narrower than the contact's own
// (calls.person_name VARCHAR(100), calls.address VARCHAR(255) ... versus contacts.person_name VARCHAR(255), contacts.address TEXT).
// Under strict SQL mode a contact with a longer name or address made the INSERT fail ("Data too long") and the caller only saw
// "Internal server error" - for those contacts alone. The widths are read from the database (never hardcoded), and a snapshot
// value is clipped to fit; the full value stays on the contact, which the call is linked to by contact_id.
let limits = null;
export async function callTextLimits() {
  if (limits) return limits;
  try {
    const rows = await query(
      `SELECT COLUMN_NAME AS c, CHARACTER_MAXIMUM_LENGTH AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calls' AND DATA_TYPE IN ('varchar','char')`
    );
    limits = Object.fromEntries(rows.map((r) => [r.c, Number(r.n) || null]));
  } catch { limits = {}; }
  return limits;
}
// Returns the value clipped to the column's width (null/undefined/"" unchanged).
export function fitToColumn(value, max) {
  if (value == null || !max) return value;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}
