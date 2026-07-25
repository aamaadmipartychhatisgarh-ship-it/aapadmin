// SQL fragments for follow-up "due now" vs "scheduled later", made time-aware
// when the optional follow_up_time column exists. A contact is due once its
// follow_up_date has passed, or it's today and the follow_up_time (if any) has
// arrived. Rows with no time fall back to being due for the whole day.
//
//   alias   — table alias that owns the columns ("c") or "" for none
//   hasTime — whether follow_up_time exists (from hasFollowUpTimeColumn())

export function dueClause(alias = "", hasTime = false) {
  const t = alias ? `${alias}.` : "";
  if (!hasTime) {
    return `(${t}follow_up_date IS NULL OR ${t}follow_up_date <= CURDATE())`;
  }
  return `(${t}follow_up_date IS NULL
    OR ${t}follow_up_date < CURDATE()
    OR (${t}follow_up_date = CURDATE() AND (${t}follow_up_time IS NULL OR ${t}follow_up_time <= CURTIME())))`;
}

export function laterClause(alias = "", hasTime = false) {
  const t = alias ? `${alias}.` : "";
  if (!hasTime) {
    return `(${t}follow_up_date IS NOT NULL AND ${t}follow_up_date > CURDATE())`;
  }
  return `(${t}follow_up_date IS NOT NULL
    AND (${t}follow_up_date > CURDATE()
         OR (${t}follow_up_date = CURDATE() AND ${t}follow_up_time > CURTIME())))`;
}
