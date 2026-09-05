// Chhattisgarh geography name normalization + spelling-variant aliases — the
// SINGLE SOURCE OF TRUTH shared by every importer (contacts: src/lib/workerImport.js,
// polling: src/lib/pollingImportCore.js). Pure data + a pure helper, NO imports,
// so it is safe to import from both the app (webpack/turbopack) and a bare
// `node --test` (imported via a relative path, never the "@/" alias).

// Canonical form for name comparison: trim, collapse internal whitespace,
// uppercase. Used as the map key on both sides of every geo lookup.
export function norm(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toUpperCase();
}

// Map common spelling variants in uploaded lists -> the canonical Master Data
// name (already normalized). Keys and values are all norm()-form.
export const DISTRICT_ALIASES = {
  "BALODABAJAR": "BALODABAZAR-BHATAPARA",
  "BALODA BAZAR": "BALODABAZAR-BHATAPARA",
  "BALRAMPUR": "BALRAMPUR-RAMANUJGANJ",
  "GORELA-PENDRA-MARWAHI": "GAURELA-PENDRA-MARWAHI",
  "GORELLA-PENDRA-MARWAHI": "GAURELA-PENDRA-MARWAHI",
  "KHAIRGARH": "KHAIRAGARH-CHHUIKHADAN-GANDAI",
  "KORIYA": "KOREA",
  "RAIGADH": "RAIGARH",
  "SARGUJA": "SURGUJA",
  "SHAKTI": "SAKTI",
  "KAWARDHA": "KABEERDHAM",
  "KABIRDHAM": "KABEERDHAM",
  "DANTEWADA": "DAKSHIN BASTAR DANTEWADA",
  "KANKER": "UTTAR BASTAR KANKER",
};
export const ASSEMBLY_ALIASES = {
  "BRINDANAWAGARH": "BINDRAWAGARH",
  "BINDRANAWAGARH": "BINDRAWAGARH",
  "DHARAMJAYGARH": "DHARAMJAIGARH",
  "DURG GRAMIN": "DURG RURAL",
  "KHARSIYA": "KHARSIA",
  "PALITANAKHAR": "PALI-TANAKHAR",
  "PALI TANAKHAR": "PALI-TANAKHAR",
  "RAIGADH": "RAIGARH",
  "RAIPUR NORTH": "RAIPUR CITY NORTH",
  "RAIPUR WEST": "RAIPUR CITY WEST",
  "RAIPUR SOUTH": "RAIPUR CITY SOUTH",
  "RAIPUR RURAL": "RAIPUR CITY RURAL",
  "RAMANUJAGANJ": "RAMANUJGANJ",
  "SARAYPALI": "SARAIPALI",
  "PRATAPUR": "PRATAPPUR",
};
