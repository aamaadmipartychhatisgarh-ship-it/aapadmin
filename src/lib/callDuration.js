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
