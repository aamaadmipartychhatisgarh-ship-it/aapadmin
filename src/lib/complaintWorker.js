import { query } from "@/lib/db";
import { phoneKey, last10Sql } from "@/lib/phone";
import { notPendingClause } from "@/lib/contactExtras";

// Complaint ↔ Worker mapping. The Worker is the CONTACT with this mobile number
// (contacts.phone_number); the Assembly comes from that contact's own
// contacts.assembly_id — never guessed from the district or typed by hand.
//
// Matching is on the last 10 digits (so "+91 98…" and "98…" are the same person),
// live contacts only (pending/rejected submissions are not workers yet). Because
// two contact rows can share a number written in different formats, the result
// says exactly how sure it is instead of silently picking one:
//   none      – no live contact with this number
//   unique    – one contact (or several that all map to the SAME assembly)
//   multiple  – several contacts with DIFFERENT assemblies → the caller must pick
// `assembly` is only ever set when it is unambiguous AND present on the record.

const SELECT = (extra) => `
  SELECT c.id, c.person_name, c.phone_number, c.assembly_id, c.district_id,
         la.name AS assembly_name, ld.name AS district_name
    FROM contacts c
    LEFT JOIN locations la ON la.id = c.assembly_id
    LEFT JOIN locations ld ON ld.id = c.district_id
   WHERE ${extra}`;

export async function findWorkersByPhone(phone) {
  const key = phoneKey(phone);
  if (!key || key.length < 10) return { status: "none", matches: [], assembly: null };
  const live = await notPendingClause("c");
  const matches = await query(
    `${SELECT(`${last10Sql("c.phone_number")} = ?${live}`)} ORDER BY c.id ASC LIMIT 25`,
    [key]
  );
  return summarize(matches);
}

export async function findWorkerById(contactId, phone) {
  const id = Number(contactId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [row] = await query(`${SELECT("c.id = ?")} LIMIT 1`, [id]);
  if (!row) return null;
  // The chosen contact must really be the owner of the number on the complaint.
  const key = phoneKey(phone);
  if (key && phoneKey(row.phone_number) !== key) return null;
  return row;
}

function summarize(matches) {
  if (!matches.length) return { status: "none", matches: [], assembly: null };
  const asms = new Set(matches.map((m) => m.assembly_id).filter((v) => v != null).map(String));
  const withAsm = matches.filter((m) => m.assembly_id != null);
  if (asms.size > 1) return { status: "multiple", matches, assembly: null };
  if (asms.size === 1) {
    const m = withAsm[0];
    return { status: "unique", matches, assembly: { id: m.assembly_id, name: m.assembly_name }, worker: m };
  }
  // Found, but no assembly recorded on any matching contact.
  return { status: matches.length > 1 ? "multiple" : "unique", matches, assembly: null, worker: matches.length === 1 ? matches[0] : null };
}

// The Assembly (and district, when the form left it blank) to SAVE with a
// complaint, derived server-side from the real record — a client-sent assembly is
// never trusted. Returns { assembly_id, district_id, contact_id } (nulls when it
// cannot be determined safely).
export async function resolveComplaintLocation({ phone, contactId }) {
  const empty = { assembly_id: null, district_id: null, contact_id: null };
  if (!phoneKey(phone)) return empty;
  if (contactId != null && contactId !== "") {
    const w = await findWorkerById(contactId, phone);
    return w ? { assembly_id: w.assembly_id ?? null, district_id: w.district_id ?? null, contact_id: w.id } : empty;
  }
  const r = await findWorkersByPhone(phone);
  if (r.status === "unique" && r.worker) {
    return { assembly_id: r.assembly?.id ?? null, district_id: r.worker.district_id ?? null, contact_id: r.worker.id };
  }
  return empty; // none / ambiguous → never guess
}
