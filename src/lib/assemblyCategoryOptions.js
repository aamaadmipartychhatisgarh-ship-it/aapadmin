// Assembly reservation category options (client-safe — no DB import). The value
// is a property of the ASSEMBLY seat, stored on its master row and set in
// Administration → Master Data; never derived from an MLA's caste or party.
export const ASSEMBLY_CATEGORIES = [
  { value: "GEN", label: "General" },
  { value: "SC", label: "SC" },
  { value: "ST", label: "ST" },
];
export const ASSEMBLY_CATEGORY_VALUES = ASSEMBLY_CATEGORIES.map((c) => c.value);
export const ASSEMBLY_CATEGORY_LABEL = Object.fromEntries(ASSEMBLY_CATEGORIES.map((c) => [c.value, c.label]));

// Canonical code for an incoming value, or null when it isn't one of the three.
export function normalizeAssemblyCategory(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "GENERAL") return "GEN";
  return ASSEMBLY_CATEGORY_VALUES.includes(s) ? s : null;
}
