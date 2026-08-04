// Single source of truth for the Contacts status buckets (Pending / Done /
// Assigned / Pool), so the admin dashboard counts, the contacts list, and
// Distribute can never disagree on what each one means.
//
// `contacts` has no status column — everything is derived from two
// independent fields: `is_completed` (has this person been called) and
// `assigned_to_user_id` (who currently owns it). "Pool" must require BOTH
// unfinished AND unassigned — a Done contact whose caller was removed
// (single-row unassign, or the caller's account being deleted) is not
// "waiting to be worked", it's just done, so it must not count as pool.
// This matches what was already the operational definition everywhere a
// contact actually gets picked up — src/app/api/workspace/claim/route.js,
// src/app/api/workspace/topup/route.js, src/app/api/assignment-rules/route.js
// — only the dashboard counters and Distribute's own filter had drifted to
// the looser `assigned_to_user_id IS NULL` (no completion check).
export function statusWhere(status, alias = "c") {
  switch (status) {
    case "pending": return `${alias}.is_completed = 0`;
    case "done": return `${alias}.is_completed = 1`;
    case "assigned": return `${alias}.assigned_to_user_id IS NOT NULL`;
    case "pool": return `${alias}.assigned_to_user_id IS NULL AND ${alias}.is_completed = 0`;
    default: return null;
  }
}
