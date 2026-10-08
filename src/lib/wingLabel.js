// Short display label for a stored wing name ("SC Wing" -> "SC",
// "Main Organisation" -> "Main"). This is a PURE display transform — the wing LIST
// itself always comes from Master Data (/api/wings), never a hardcoded array. Used
// by every Wings dropdown so the short labels read identically everywhere.
export function wingShortLabel(name) {
  const s = String(name || "").trim();
  if (/^main organisation$/i.test(s)) return "Main";
  return s.replace(/\s+wing$/i, "");
}
