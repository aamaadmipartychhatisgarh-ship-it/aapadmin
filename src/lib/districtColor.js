// District → colour, for the Incomplete Designation lists. The colour is a pure
// function of the district's id, so the same District is ALWAYS the same colour
// (across levels, pages, searches, filters and refreshes) — nothing is stored.
// A fixed palette of subtle pastel backgrounds, each paired with a darker accent for
// the left edge; text stays the page's normal dark grey on every background
// (all backgrounds are ≥ 14:1 contrast against #111827).
export const DISTRICT_PALETTE = [
  { bg: "#EAF2FE", accent: "#6FA0E6" }, // blue
  { bg: "#E8F6EC", accent: "#6CBF86" }, // green
  { bg: "#FFF3E0", accent: "#E5A957" }, // amber
  { bg: "#F3EAFB", accent: "#A47BD6" }, // violet
  { bg: "#FDEBEF", accent: "#E27D93" }, // rose
  { bg: "#E6F6F6", accent: "#5FBDBD" }, // teal
  { bg: "#FBF5DB", accent: "#CDB445" }, // yellow
  { bg: "#EAEFFA", accent: "#7C8FD8" }, // indigo
  { bg: "#FDEDE4", accent: "#E5906A" }, // coral
  { bg: "#EEF6E1", accent: "#9BC254" }, // lime
  { bg: "#F7EAF4", accent: "#C984B8" }, // orchid
  { bg: "#E9F0F3", accent: "#7E9EAE" }, // slate
];

// Returns { bg, accent } for a district id, or null when the row has no district
// (State / Zone / Lok Sabha rows, or a location with no mapped district).
export function districtColor(districtId) {
  const n = Number(districtId);
  if (!Number.isInteger(n) || n <= 0) return null;
  return DISTRICT_PALETTE[n % DISTRICT_PALETTE.length];
}
