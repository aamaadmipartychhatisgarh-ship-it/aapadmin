// Phone matching between the contacts and workers tables. Numbers are stored
// inconsistently ("+91 98765…", "098765…", "98765…"), so identity is decided on
// the last 10 digits — the same rule the worker dedup logic already uses.

// Normalize a phone string to its last 10 digits (JS side, for bound params).
export function phoneKey(v) {
  if (!v) return null;
  const digits = String(v).replace(/\D/g, "");
  return digits ? digits.slice(-10) : null;
}

// SQL expression that reduces a column to its last 10 digits, mirroring phoneKey.
// Kept identical to the dedup expression in the workers routes.
export function last10Sql(col) {
  return `RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${col}, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', ''), 10)`;
}
