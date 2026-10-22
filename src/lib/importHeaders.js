// Header-name → field matching for the Excel/CSV importers. Client + server safe
// (no DB access), so a browser pre-check reads a sheet exactly as the server will.
// Moved verbatim from src/lib/workerImport.js, which re-exports it.
export const COLUMN_MAP = {
  name: ["name", "person name", "person_name", "member name", "full name", "contact name", "contact person"],
  mobile: ["contact no", "contact", "mobile", "mobile number", "mobile_number", "phone", "phone number", "phone_number", "phone no", "mobile no", "contact number", "contact_no", "whatsapp", "whatsapp number"],
  zone: ["zone"],
  lok_sabha: ["lok sabha", "lok_sabha", "loksabha", "lok sabha constituency", "loksabha constituency", "parliament", "parliamentary constituency", "ls"],
  district: ["jila", "district", "zila"],
  assembly: ["vidhansabha", "vidhan sabha", "assembly", "assembly constituency", "constituency", "ac"],
  block: ["block", "mandal", "ward"], // "Block" in the product spec = the `ward` location type
  booth: ["polling booth", "polling station", "booth", "booth no", "booth number"],
  address: ["address", "village", "gram", "city"],
  designation: ["designation", "position", "role", "padasthapana"],
  membership_no: ["membership no", "membership number", "membership_no", "member id", "member no"],
  worker_type: ["worker type", "type", "employment type"],
};

export function buildHeaderIndex(headerRow) {
  const idx = {};
  headerRow.forEach((h, i) => {
    // Normalise: trim, lowercase, collapse internal whitespace, drop trailing
    // punctuation (e.g. "Phone No." / "Person  Name") so header variants match.
    const key = String(h || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.:]+$/, "");
    if (!key) return;
    for (const [field, names] of Object.entries(COLUMN_MAP)) {
      // First match wins, so an earlier exact column isn't overwritten by a
      // later looser alias.
      if (idx[field] === undefined && names.includes(key)) idx[field] = i;
    }
  });
  return idx;
}
