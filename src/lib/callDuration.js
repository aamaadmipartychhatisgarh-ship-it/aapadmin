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
