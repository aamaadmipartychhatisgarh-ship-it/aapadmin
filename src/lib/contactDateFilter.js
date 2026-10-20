import { query } from "@/lib/db";

// "Added date" filter for the Contacts lists — filters on contacts.created_at (when the
// contact was ADDED), never updated_at. The user picks CALENDAR DATES in India Standard
// Time (the app's working timezone); the boundaries are converted to the database
// session's time zone, so a contact created at 23:59 or 00:01 IST lands on the right
// day whatever zone the DB server runs in (UTC, IST, …).
//   ?added_on=YYYY-MM-DD                       one date
//   ?added_from=YYYY-MM-DD&added_to=YYYY-MM-DD a range (either end may be left open)
// A single date is the range [d, d]. Both ends are inclusive whole days.
export const APP_TZ_OFFSET = "+05:30";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s) {
  if (!ISO.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function nextDay(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

let _hasCreated;
async function hasCreatedAt() {
  if (_hasCreated === undefined) {
    _hasCreated = query(`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts' AND COLUMN_NAME = 'created_at'`)
      .then((r) => Number(r[0]?.n) > 0).catch(() => { _hasCreated = undefined; return false; });
  }
  return _hasCreated;
}

// → { sql, params } to append to a WHERE (sql is "" when no date filter is active), or
// { error } for an invalid request. `alias` is the contacts alias.
export async function addedDateClause(searchParams, alias = "c") {
  let from = (searchParams.get("added_from") || "").trim();
  let to = (searchParams.get("added_to") || "").trim();
  const on = (searchParams.get("added_on") || "").trim();
  if (on) { from = on; to = on; }
  if (!from && !to) return { sql: "", params: [] };
  for (const v of [from, to]) if (v && !validDate(v)) return { error: `Invalid date "${v}". Use YYYY-MM-DD.` };
  if (from && to && from > to) return { error: "The start date is after the end date." };
  if (!(await hasCreatedAt())) return { error: "Added date is not available: contacts have no creation date column." };
  const sql = [], params = [];
  // Whole IST days → instants in the DB session's zone.
  if (from) { sql.push(`${alias}.created_at >= CONVERT_TZ(?, '${APP_TZ_OFFSET}', @@session.time_zone)`); params.push(`${from} 00:00:00`); }
  if (to) { sql.push(`${alias}.created_at < CONVERT_TZ(?, '${APP_TZ_OFFSET}', @@session.time_zone)`); params.push(`${nextDay(to)} 00:00:00`); }
  return { sql: ` AND ${sql.join(" AND ")}`, params };
}
