// Master reference data for the 33 Chhattisgarh assemblies used by the Leader
// Assessment module. This is FIXED planning/reference data (names + required-
// worker targets), not application activity — it is the authoritative seed for
// la_assemblies. Actual worker counts, MLA profiles, candidates, elections and
// assessments are NEVER hardcoded here; they come from live DB records.
//
// `aliases` list the accepted spellings so an assembly binds to its real
// `locations` district (for live worker counts) regardless of naming
// differences — e.g. "Kanker" ↔ "Uttar Bastar Kanker", "Dantewada" ↔ "Dakshin
// Bastar Dantewada", the MCB long form, "Gariaband" ↔ "Gariyaband",
// "Kabirdham" ↔ "Kabeerdham", "Koriya" ↔ "Korea", "Baloda Bazar" ↔
// "Balodabazar-Bhatapara", and the Chowki/Chouki spelling.

// Canonicalize a name for matching: lowercase, drop any parenthetical suffix
// (e.g. "(M C B)"), then strip everything that isn't a letter/digit so spaces,
// hyphens and punctuation never split one place into two.
export function normDistrict(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

export const CG_ASSEMBLIES = [
  { name: "Balod", requiredWorkers: 6000, aliases: ["Balod"] },
  { name: "Baloda Bazar", requiredWorkers: 6000, aliases: ["Baloda Bazar", "Balodabazar-Bhatapara", "Baloda Bazar-Bhatapara"] },
  { name: "Balrampur", requiredWorkers: 4000, aliases: ["Balrampur", "Balrampur-Ramanujganj"] },
  { name: "Bastar", requiredWorkers: 6000, aliases: ["Bastar"] },
  { name: "Bemetara", requiredWorkers: 6000, aliases: ["Bemetara"] },
  { name: "Bijapur", requiredWorkers: 2000, aliases: ["Bijapur"] },
  { name: "Bilaspur", requiredWorkers: 12000, aliases: ["Bilaspur"] },
  { name: "Dantewada", requiredWorkers: 2000, aliases: ["Dantewada", "Dakshin Bastar Dantewada"] },
  { name: "Dhamtari", requiredWorkers: 6000, aliases: ["Dhamtari"] },
  { name: "Durg", requiredWorkers: 12000, aliases: ["Durg"] },
  { name: "Gariaband", requiredWorkers: 4000, aliases: ["Gariaband", "Gariyaband"] },
  { name: "Gaurela-Pendra-Marwahi", requiredWorkers: 2000, aliases: ["Gaurela-Pendra-Marwahi", "Gaurella-Pendra-Marwahi", "GPM"] },
  { name: "Janjgir-Champa", requiredWorkers: 6000, aliases: ["Janjgir-Champa", "Janjgir Champa"] },
  { name: "Jashpur", requiredWorkers: 6000, aliases: ["Jashpur"] },
  { name: "Kabirdham", requiredWorkers: 4000, aliases: ["Kabirdham", "Kabeerdham", "Kawardha"] },
  { name: "Kanker", requiredWorkers: 6000, aliases: ["Kanker", "Uttar Bastar Kanker"] },
  { name: "Khairagarh-Chhuikhadan-Gandai", requiredWorkers: 2000, aliases: ["Khairagarh-Chhuikhadan-Gandai", "Khairagarh Chhuikhadan Gandai", "KCG"] },
  { name: "Kondagaon", requiredWorkers: 4000, aliases: ["Kondagaon"] },
  { name: "Korba", requiredWorkers: 8000, aliases: ["Korba"] },
  { name: "Koriya", requiredWorkers: 4000, aliases: ["Koriya", "Korea", "Koria"] },
  { name: "MCB (Manendragarh-Chirmiri-Bharatpur)", requiredWorkers: 2000, aliases: ["MCB", "Manendragarh-Chirmiri-Bharatpur", "Manendragarh-Chirmiri-Bharatpur(M C B)", "Manendragarh Chirmiri Bharatpur"] },
  { name: "Mahasamund", requiredWorkers: 8000, aliases: ["Mahasamund"] },
  { name: "Mohla-Manpur-Ambagarh Chowki", requiredWorkers: 2000, aliases: ["Mohla-Manpur-Ambagarh Chowki", "Mohla-Manpur-Ambagarh Chouki", "Mohla Manpur Ambagarh Chowki"] },
  { name: "Mungeli", requiredWorkers: 4000, aliases: ["Mungeli"] },
  { name: "Narayanpur", requiredWorkers: 2000, aliases: ["Narayanpur"] },
  { name: "Raigarh", requiredWorkers: 8000, aliases: ["Raigarh"] },
  { name: "Raipur", requiredWorkers: 14000, aliases: ["Raipur"] },
  { name: "Rajnandgaon", requiredWorkers: 8000, aliases: ["Rajnandgaon"] },
  { name: "Sakti", requiredWorkers: 6000, aliases: ["Sakti"] },
  { name: "Sarangarh-Bilaigarh", requiredWorkers: 4000, aliases: ["Sarangarh-Bilaigarh", "Sarangarh Bilaigarh"] },
  { name: "Sukma", requiredWorkers: 2000, aliases: ["Sukma"] },
  { name: "Surajpur", requiredWorkers: 6000, aliases: ["Surajpur"] },
  { name: "Surguja", requiredWorkers: 6000, aliases: ["Surguja"] },
];

// Total of the fixed targets (used for validation / the Overview card).
export const CG_TOTAL_REQUIRED_WORKERS = CG_ASSEMBLIES.reduce((s, a) => s + a.requiredWorkers, 0);

// Fixed Required-Workers target for a district, resolved by normalized name (or
// any alias) so it binds regardless of the master spelling. Single source of
// truth shared by the Strength page and Area Ranking (their percentages must
// agree). Returns 0 when the name doesn't match a Chhattisgarh district.
const REQUIRED_BY_NORM = {};
for (const a of CG_ASSEMBLIES) {
  REQUIRED_BY_NORM[normDistrict(a.name)] = a.requiredWorkers;
  for (const al of a.aliases) REQUIRED_BY_NORM[normDistrict(al)] = a.requiredWorkers;
}
export function requiredWorkersFor(name) {
  return REQUIRED_BY_NORM[normDistrict(name)] ?? 0;
}
