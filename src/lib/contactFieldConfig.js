// ONE field registry for the Contact ("Worker") record as the Edit form exposes it. The Contact EXPORT
// headings, the Import / Import Edit TEMPLATE and the header aliases both importers read are all derived from
// it, so a field is named the same everywhere and an exported sheet can be edited and imported back as is.
// Pure (client-safe): no database access.
//   key     - internal field key (the importers' vocabulary)
//   label   - the canonical column heading (export + template)
//   aliases - other headings accepted on import (case / spacing / trailing-punctuation insensitive)
//   sample  - example value shown in the template's sample row
//   note    - one-line rule shown in the template's "Instructions" sheet
export const CONTACT_FIELDS = [
  { key: "id", label: "Contact ID", aliases: ["contact id", "contactid", "contact_id", "id", "sr id", "worker id"], sample: "1234", note: "Identifies the existing contact (preferred). Leave empty / omit the column to match by Mobile Number." },
  { key: "name", label: "Name", aliases: ["name", "person name", "contact name", "full name", "new name", "person_name"], sample: "Ramesh Sahu", note: "Required for a new contact. Cannot be cleared." },
  { key: "phone", label: "Mobile Number", aliases: ["phone", "mobile", "phone number", "mobile number", "phone no", "mobile no", "contact number", "mobile no.", "phone_number", "contact no"], sample: "9876543210", note: "10-digit mobile. Matched on the last 10 digits, so +91 / 0 / spaces do not matter." },
  { key: "address", label: "Address", aliases: ["address", "new address"], sample: "Ward 4, Abhanpur", note: "Blank = unchanged. [clear] empties it." },
  { key: "village", label: "Village/City", aliases: ["village", "gram", "village/city", "village / city", "village city", "city"], sample: "Abhanpur", note: "Blank = unchanged. [clear] empties it." },
  { key: "pincode", label: "Pincode", aliases: ["pincode", "pin code", "pin"], sample: "492001", note: "6 digits. Blank = unchanged. [clear] empties it." },
  { key: "qualification", label: "Qualification", aliases: ["qualification", "education", "literacy"], sample: "Literate", note: "Illiterate or Literate (the exported \"Literate – 12th\" form is accepted too). Blank = unchanged." },
  { key: "education_level", label: "Education Level", aliases: ["education level", "education_level", "level of education"], sample: "12th", note: "8th, 10th, 12th, Graduate or Post Graduate or Above - only for Literate. Blank = unchanged." },
  { key: "vehicle", label: "Vehicle", aliases: ["vehicle"], sample: "Two Wheeler", note: "Two Wheeler or Four Wheeler. Blank = unchanged." },
  { key: "designation", label: "Designation", aliases: ["designation", "designations", "position", "role"], sample: "President", note: "Existing designation name(s) from Master Data; several separated by ; or |. The contact's designation set becomes exactly this list. Blank = unchanged." },
  { key: "wing", label: "Wing", aliases: ["wing", "wings"], sample: "Main Organisation", note: "The Wing of EACH designation, in the same order (\"Main Organisation\" or a Master Data Wing). Needs the Designation column. Blank = unchanged." },
  { key: "zone", label: "Zone", aliases: ["zone"], sample: "Raipur Zone", note: "Existing Zone name. Blank = unchanged." },
  { key: "lok_sabha", label: "Lok Sabha", aliases: ["lok sabha", "lok_sabha", "loksabha", "lok sabha constituency", "parliament"], sample: "Raipur", note: "Existing Lok Sabha name (must belong to the Zone). Blank = unchanged." },
  { key: "district", label: "District", aliases: ["district", "jila", "zila"], sample: "Raipur", note: "Existing District name. Blank = unchanged." },
  { key: "assembly", label: "Assembly", aliases: ["assembly", "vidhansabha", "vidhan sabha", "assembly constituency"], sample: "Abhanpur", note: "Existing Assembly name (must belong to the District). Blank = unchanged." },
  { key: "block", label: "Block", aliases: ["block", "mandal", "ward"], sample: "Abhanpur Block A", note: "Existing Block of the contact's Assembly. Blank = unchanged." },
  { key: "photo_url", label: "Photo URL", aliases: ["photo url", "photo_url", "photo"], sample: "/uploads/xxxxxxxx.jpg", note: "An uploaded photo's path (as exported). Only replaces the photo; blank never removes it." },
  { key: "assigned_caller", label: "Assigned Caller", aliases: ["assigned caller", "assigned_caller", "caller", "assigned to"], sample: "caller1", note: "Username of an active Caller. Blank = unchanged (never unassigns)." },
  { key: "status", label: "Status", aliases: ["status"], sample: "Pending", note: "Pending or Done. Assigned / Pool (as exported) change nothing. Blank = unchanged." },
  { key: "remarks", label: "Remarks/Notes", aliases: ["remarks", "remark", "notes", "remarks/notes", "remarks / notes", "remarks notes"], sample: "", note: "Blank = unchanged. [clear] empties it." },
];

export const CONTACT_FIELD_BY_KEY = Object.fromEntries(CONTACT_FIELDS.map((f) => [f.key, f]));
export const CLEAR_TOKEN = "[clear]";

export const normHeader = (h) => String(h ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.:*]+$/, "");

// header row -> { fieldKey: columnIndex } using every field's label + aliases (first match wins).
export function contactHeaderIndex(headerRow) {
  const idx = {};
  (headerRow || []).forEach((h, i) => {
    const key = normHeader(h);
    if (!key) return;
    for (const f of CONTACT_FIELDS) {
      if (idx[f.key] !== undefined) continue;
      if (normHeader(f.label) === key || f.aliases.includes(key)) idx[f.key] = i;
    }
  });
  return idx;
}

// "Name 1; Name 2" / "Name 1 | Name 2" / "Name 1, Name 2" -> ["Name 1", ...]. Designation names may themselves
// contain commas (e.g. "District President, Youth Wing"), so a comma split is resolved greedily against the KNOWN
// names (lower-cased set) - the longest known name wins - and only unknown leftovers are split plainly.
export function splitNameList(cell, knownLower = new Set()) {
  const s = String(cell ?? "").trim();
  if (!s) return [];
  const out = [];
  for (const seg of s.split(/[;|]/).map((x) => x.trim()).filter(Boolean)) {
    if (knownLower.has(seg.toLowerCase())) { out.push(seg); continue; }
    const parts = seg.split(",").map((x) => x.trim()).filter(Boolean);
    let i = 0;
    while (i < parts.length) {
      let took = false;
      for (let j = parts.length; j > i; j--) {
        const cand = parts.slice(i, j).join(", ");
        if (knownLower.has(cand.toLowerCase())) { out.push(cand); i = j; took = true; break; }
      }
      if (!took) { out.push(parts[i]); i += 1; }
    }
  }
  return out;
}
