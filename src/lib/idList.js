// "12,15,9" (or a single "12") -> { ids: [12, 15, 9], invalid: false }. Anything that is not a positive integer marks the
// whole list invalid (the endpoint answers 400) - IDs are never passed to SQL unchecked. Duplicates are dropped.
export function parseIdList(value) {
  const raw = String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ids = [];
  for (const s of raw) {
    if (!/^\d+$/.test(s) || Number(s) <= 0) return { ids: [], invalid: true };
    if (!ids.includes(Number(s))) ids.push(Number(s));
  }
  return { ids, invalid: false };
}
