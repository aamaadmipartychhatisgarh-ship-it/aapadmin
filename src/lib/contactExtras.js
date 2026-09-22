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

// Optional contacts.photo_updated_at column (scripts/add-contact-timestamps.mjs)
// — audit stamp for when a contact's photo was last set/replaced/cleared, so a
// "photo disappeared" report can be traced to WHEN it changed.
let _photoUpdatedAt;
export async function hasContactPhotoUpdatedAtColumn() {
  if (_photoUpdatedAt !== undefined) return _photoUpdatedAt;
  try {
    const rows = await query("SHOW COLUMNS FROM contacts LIKE 'photo_updated_at'");
    _photoUpdatedAt = rows.length > 0;
  } catch {
    _photoUpdatedAt = false;
  }
  return _photoUpdatedAt;
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

// "Not Interested" — a PERSISTENT contact state (mirrors the Wrong Number flag).
// A contact enters it when a call sentiment is Negative / Opponent / Not a Supporter
// (set in /api/calls), and it then disappears from every active/Main contacts list
// and from assignment until an authorized user EXPLICITLY restores it. The state is
// three additive columns on `contacts`, created + backfilled once per process the
// first time the column is missing (no manual migration needed). The backfill moves
// EXISTING contacts whose call history already shows one of those sentiments, so the
// rule applies to old data too, not just new calls.
let _notInterestedReady = false; // only ever cached as true (a failure retries)
const _niColsSql = `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts'
          AND COLUMN_NAME IN ('is_not_interested','not_interested_reason','not_interested_at')`;
export async function ensureNotInterestedColumns() {
  if (_notInterestedReady) return true;
  try {
    let have = new Set((await query(_niColsSql)).map((r) => r.c));
    const firstCreate = !have.has("is_not_interested");
    // Each ALTER is individually guarded: a concurrent first-request race (two
    // processes both adding the column) fails the loser with "duplicate column",
    // which is fine — the re-verify below confirms the column exists either way.
    const add = async (name, ddl) => {
      if (have.has(name)) return;
      try { await query(`ALTER TABLE contacts ADD COLUMN ${name} ${ddl}`); }
      catch (e) { if (!/duplicate column/i.test(e?.message || "")) console.error(`[not-interested] add ${name}:`, e?.message || e); }
    };
    await add("is_not_interested", "TINYINT NOT NULL DEFAULT 0");
    await add("not_interested_reason", "VARCHAR(40) NULL");
    await add("not_interested_at", "TIMESTAMP NULL");
    try { await query("CREATE INDEX idx_contacts_not_interested ON contacts (is_not_interested)"); } catch { /* index already exists */ }
    have = new Set((await query(_niColsSql)).map((r) => r.c));
    const ok = have.has("is_not_interested");
    if (ok && firstCreate) {
      // One-time backfill so existing negative-sentiment contacts are consistent
      // with the new auto-transition (same three sentiments the call log sets). Runs
      // only when the column was just created, before any restore can exist, so it
      // never re-flags a contact someone has already restored.
      await query(
        `UPDATE contacts c
            SET c.is_not_interested = 1, c.not_interested_reason = 'sentiment', c.not_interested_at = NOW()
          WHERE (c.is_not_interested = 0 OR c.is_not_interested IS NULL)
            AND EXISTS (SELECT 1 FROM calls cx WHERE cx.contact_id = c.id
                          AND cx.sentiment IN ('negative','opponent','not_supporter'))`
      ).catch((e) => console.error("[not-interested] backfill:", e?.message || e));
    }
    if (ok) _notInterestedReady = true;
    return ok;
  } catch (e) {
    console.error("[not-interested] ensureNotInterestedColumns:", e?.message || e);
    return false;
  }
}

// AND-clause that keeps Not-Interested contacts OUT of an active/assignable list.
// Ensures the column exists (and backfills) first, so callers can rely on it.
export async function notNotInterestedClause(alias = "c") {
  if (!(await ensureNotInterestedColumns())) return "";
  return ` AND (${alias}.is_not_interested = 0 OR ${alias}.is_not_interested IS NULL)`;
}

// Is this contact currently Not Interested? Used by assignment endpoints to REJECT
// assigning a Not-Interested contact server-side (never rely on frontend hiding).
export async function isContactNotInterested(contactId) {
  if (!(await ensureNotInterestedColumns())) return false;
  try {
    const [row] = await query("SELECT is_not_interested FROM contacts WHERE id = ?", [contactId]);
    return !!(row && Number(row.is_not_interested) === 1);
  } catch { return false; }
}
