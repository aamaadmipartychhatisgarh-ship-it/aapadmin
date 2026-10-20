import { query } from "@/lib/db";

// Contact Qualification — two additive columns on `contacts`:
//   qualification   'illiterate' | 'literate'   (NULL = not recorded)
//   education_level '8th' | '10th' | '12th' | 'graduate' | 'post_graduate'
//                   — only ever set when qualification = 'literate'.
// The rule is enforced HERE (server-side) for every write path: Illiterate clears the
// education level, so a stale level can never be stored or shown.
import { QUALIFICATIONS, EDUCATION_LEVELS, _Q as Q, _E as E } from "@/lib/qualificationOptions";
export { QUALIFICATIONS, EDUCATION_LEVELS, qualificationLabel } from "@/lib/qualificationOptions";

let _ensured = false;
// Adds the two columns once (idempotent, race-safe). Call before reading the contacts
// column set so the new fields are included.
export async function ensureQualificationColumns() {
  if (_ensured) return true;
  try {
    const have = new Set((await query(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contacts' AND COLUMN_NAME IN ('qualification','education_level')`
    )).map((r) => r.c));
    for (const [name, ddl] of [["qualification", "VARCHAR(20) NULL"], ["education_level", "VARCHAR(20) NULL"]]) {
      if (have.has(name)) continue;
      try { await query(`ALTER TABLE contacts ADD COLUMN ${name} ${ddl}`); }
      catch (e) { if (!/duplicate column/i.test(e?.message || "")) throw e; }
    }
    _ensured = true;
  } catch (e) {
    console.error("[contacts] ensureQualificationColumns:", e?.message || e);
  }
  return _ensured;
}

// Validate + normalise the qualification part of a request body.
//   → { present:false }                      body says nothing about it (leave as is)
//   → { present:true, qualification, education_level }   values to store (nulls clear)
//   → { error }                              invalid input (HTTP 400)
export function normalizeQualification(data) {
  const hasQ = data && "qualification" in data;
  const hasE = data && "education_level" in data;
  if (!hasQ && !hasE) return { present: false };
  const q = hasQ ? String(data.qualification ?? "").trim().toLowerCase() : "";
  const e = hasE ? String(data.education_level ?? "").trim().toLowerCase() : "";
  if (!hasQ && e) return { error: "Select a Qualification (Literate) before an education level." };
  if (q && !Q.has(q)) return { error: "Qualification must be Illiterate or Literate." };
  if (e && !E.has(e)) return { error: "Invalid education level." };
  if (!q) return { present: true, qualification: null, education_level: null };            // cleared
  if (q === "illiterate") return { present: true, qualification: "illiterate", education_level: null }; // no level for Illiterate
  return { present: true, qualification: "literate", education_level: e || null };
}
