import { query } from "@/lib/db";

// The "Wrong Number" feature relies on an optional `contacts.is_wrong_number`
// column added by scripts/add-wrong-number-flag.mjs. So the app keeps working
// before that migration is run (on deploy), every query that touches the column
// first checks it exists. The result is cached for the life of the process.
let _wrongCol; // undefined = unknown, then boolean

export async function hasWrongNumberColumn() {
  if (_wrongCol !== undefined) return _wrongCol;
  try {
    const rows = await query("SHOW COLUMNS FROM contacts LIKE 'is_wrong_number'");
    _wrongCol = rows.length > 0;
  } catch {
    _wrongCol = false;
  }
  return _wrongCol;
}
