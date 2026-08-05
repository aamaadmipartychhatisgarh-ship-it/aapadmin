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

// Optional contacts.photo_url column (scripts/add-contact-photo-url.mjs) —
// gives contacts their own native photo, decoupled from the (removed)
// Worker Management module.
let _photoUrl;
export async function hasContactPhotoColumn() {
  if (_photoUrl !== undefined) return _photoUrl;
  try {
    const rows = await query("SHOW COLUMNS FROM contacts LIKE 'photo_url'");
    _photoUrl = rows.length > 0;
  } catch {
    _photoUrl = false;
  }
  return _photoUrl;
}

// Optional contacts.follow_up_time column (scripts/add-followup-time.mjs).
let _fupTime;
export async function hasFollowUpTimeColumn() {
  if (_fupTime !== undefined) return _fupTime;
  try {
    const rows = await query("SHOW COLUMNS FROM contacts LIKE 'follow_up_time'");
    _fupTime = rows.length > 0;
  } catch {
    _fupTime = false;
  }
  return _fupTime;
}

// Optional wrong_number_reason/notes/at/by/call_id + restored_at/by columns
// (scripts/add-wrong-number-detail.mjs) — added together, so one flag covers all.
let _wrongDetail;
export async function hasWrongNumberDetailColumns() {
  if (_wrongDetail !== undefined) return _wrongDetail;
  try {
    const rows = await query("SHOW COLUMNS FROM contacts LIKE 'wrong_number_reason'");
    _wrongDetail = rows.length > 0;
  } catch {
    _wrongDetail = false;
  }
  return _wrongDetail;
}

// THE data-isolation fix: a Wrong Number contact must disappear from every
// active calling/list/assignment/dashboard query and surface only in the
// dedicated Wrong Numbers module. Every query that lists or selects
// candidate contacts (except the Wrong Numbers module itself, and reports
// where the admin explicitly opened the Wrong Number filter) must AND this
// in. Centralized here so every call site uses the exact same predicate —
// same defensive `hasWrongNumberColumn()` gate + `OR IS NULL` form already
// proven in workspace/queue and workspace/claim.
export async function notWrongNumberClause(alias = "c") {
  if (!(await hasWrongNumberColumn())) return "";
  return ` AND (${alias}.is_wrong_number = 0 OR ${alias}.is_wrong_number IS NULL)`;
}
