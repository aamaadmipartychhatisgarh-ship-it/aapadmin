import { designationLevelLabel } from "@/lib/designationLevels";

// Shared helpers for the composed designation naming the Master uses. A single
// "designation" (e.g. "Vice President") is stored as ONE ROW PER (level, wing),
// with the name composed as "<Level> <Base>[, <Wing>]" (the Main Organisation
// wing carries no suffix). These helpers compose that name and recover the base
// from it, so the multi-Wing editor can treat the sibling rows that share a base
// + level as one logical designation with many Wings — without a parallel
// junction table that would orphan every wing-aware query.

// Compose the stored designation name for a base role at a level + wing. Mirrors
// the POST /api/designations composition exactly so names stay consistent.
export function composeDesignationName(level, base, wing) {
  let composed = String(base || "").trim();
  if (!composed) return composed;
  const levelLabel = designationLevelLabel(level) || level;
  if (levelLabel && !composed.toLowerCase().startsWith(String(levelLabel).toLowerCase())) {
    composed = `${levelLabel} ${composed}`;
  }
  if (wing && wing !== "Main Organisation" && !composed.toLowerCase().includes(String(wing).toLowerCase())) {
    composed = `${composed}, ${wing}`;
  }
  return composed;
}

// Recover the base role from a composed name: strip the leading "<Level> " prefix
// and a trailing ", <Wing>" suffix (longest wing match first, so "Social Media
// Wing" wins over a shorter partial). `wingNames` is the authoritative wing list.
export function deriveDesignationBase(name, level, wingNames = []) {
  let base = String(name || "").trim();
  const levelLabel = designationLevelLabel(level) || level;
  if (levelLabel) {
    const pre = `${String(levelLabel)} `.toLowerCase();
    if (base.toLowerCase().startsWith(pre)) base = base.slice(pre.length);
  }
  const sorted = [...wingNames]
    .filter((w) => w && w !== "Main Organisation")
    .sort((a, b) => String(b).length - String(a).length);
  for (const w of sorted) {
    const suf = `, ${w}`.toLowerCase();
    if (base.toLowerCase().endsWith(suf)) { base = base.slice(0, base.length - suf.length); break; }
  }
  return base.trim();
}
