// Short display label for a stored wing name ("SC Wing" -> "SC", "Main Organisation(s)" -> "Main"). This is a PURE
// display transform applied to whatever Wings are configured in Master Data (/api/wings) — the stored names are never
// changed and nothing is a hardcoded list. The section heading already says "Wing", so the word is not repeated.
// `isMain` (the Wing master's is_main flag) labels the main wing "Main" whatever it is called.
export function wingShortLabel(name, isMain = false) {
  const s = String(name || "").trim();
  if (isMain || /^main(\s+organi[sz]ations?)?$/i.test(s)) return "Main";
  const short = s.replace(/[\s\-–—]*\bwings?\b\.?$/i, "").replace(/^wings?\b[\s\-–—:]*/i, "").trim();
  return short || s;
}
