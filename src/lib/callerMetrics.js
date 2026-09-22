// Canonical caller/report metric calculations — the ONE place a "connect
// rate" is computed. Reports Certification Phase 1 audit found this formula
// duplicated inline at two call sites within the same file
// (src/app/api/admin/caller-report/route.js: per-caller rows and the rolled-
// up totals) — identical today, but two copies of the same formula is
// exactly how a report and its own summary silently disagree the next time
// only one of them gets edited. Extracted here so there is one formula, one
// test, and every caller of "connect rate" — Caller Report now, any future
// surface — imports it instead of re-deriving it.

/**
 * Percentage of calls that reached "Phone Picked", rounded to the nearest
 * whole percent. 0 when there are no calls (never divide by zero, never NaN).
 * @param {number} total
 * @param {number} connected
 * @returns {number}
 */
export function connectRate(total, connected) {
  const t = Number(total) || 0;
  const c = Number(connected) || 0;
  if (t <= 0) return 0;
  return Math.round((c / t) * 100);
}
