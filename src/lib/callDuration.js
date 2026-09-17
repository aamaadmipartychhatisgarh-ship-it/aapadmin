// Call Duration is stored in SECONDS (calls.duration_seconds) and is always a
// non-negative amount of time — a call cannot last a negative number of seconds.
// A bad or inconsistent pair of timestamps (end before start, clock/timezone
// skew) must therefore resolve to 0, never a negative value, so nothing like
// "-00:05" can ever be produced or persisted.

// Coerce any incoming value to a non-negative integer number of seconds, or null
// when there is genuinely no value. Used to clamp a client-supplied duration
// before it is stored (never trust a negative client value) and to harden
// display against any historical negative already in the database — without
// rewriting stored rows.
export function normalizeDurationSeconds(v) {
  if (v == null || v === "") return null;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return null;
  return n < 0 ? 0 : n;
}

// Human-readable Call Duration for record views: "X Hour(s) Y Minute(s)".
//   • Input is the stored duration in SECONDS (the canonical unit).
//   • Seconds are truncated to whole minutes (record views show H+M, not raw
//     seconds), consistently for every row.
//   • Never negative (a bad value clamps to 0), correct singular/plural, and any
//     zero part is dropped ("1 Hour", "45 Minutes") — except a genuine
//     zero-duration call, which shows "0 Minutes".
//   • null / blank / non-numeric → the caller's placeholder (empty-state), so it
//     is never "null", "undefined" or "NaN".
export function formatDurationHrMin(v, placeholder = "—") {
  if (v == null || v === "") return placeholder;
  let s = Math.floor(Number(v));
  if (!Number.isFinite(s)) return placeholder;
  if (s < 0) s = 0;
  const totalMin = Math.floor(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const parts = [];
  if (h > 0) parts.push(`${h} ${h === 1 ? "Hour" : "Hours"}`);
  if (m > 0) parts.push(`${m} ${m === 1 ? "Minute" : "Minutes"}`);
  return parts.length ? parts.join(" ") : "0 Minutes";
}

// Compact, human-readable Call Duration for the Call Records UI: "H Hr M Min S Sec".
//   • Input is the stored duration in SECONDS (the canonical unit) — seconds are
//     preserved (unlike formatDurationHrMin, which truncates to minutes).
//   • Any zero part is dropped ("1 Hr 32 Sec", "25 Min 32 Sec", "45 Sec"), so a
//     unit is only shown when it carries a value — EXCEPT a genuine zero-duration
//     call, which shows "0 Sec" (a valid outcome, never an error).
//   • Never negative — a bad/inconsistent value clamps to 0, never "-5 Min".
//   • null / blank / non-numeric → the caller's placeholder, so it is never
//     "null", "undefined" or "NaN".
// This is the ONE formatter for user-facing Call Records durations (table rows,
// the Search-Card total, call detail), so every surface reads identically while
// the stored numeric duration stays untouched for sorting/aggregation/exports.
export function formatDurationHrMinSec(v, placeholder = "—") {
  if (v == null || v === "") return placeholder;
  let s = Math.floor(Number(v));
  if (!Number.isFinite(s)) return placeholder;
  if (s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (h > 0) parts.push(`${h} Hr`);
  if (m > 0) parts.push(`${m} Min`);
  if (sec > 0) parts.push(`${sec} Sec`);
  return parts.length ? parts.join(" ") : "0 Sec";
}
