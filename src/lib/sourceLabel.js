// Display label of a contact's ORIGINAL source, from the existing fields only (contacts.source,
// contacts.source_unfiltered_contact_id, contacts.source_registration_id). null = genuinely no source
// recorded - the UI then shows SOURCE_NOT_AVAILABLE; nothing is ever guessed.
export const SOURCE_NOT_AVAILABLE = "Not Available";
export function contactSourceLabel(r = {}) {
  if (r.source_unfiltered_contact_id || r.source === "unfiltered_calls") return "Unfiltered Calls";
  if (r.source_registration_id) return "Worker & Voter Registration";
  const s = String(r.source ?? "").trim();
  if (!s) return null;
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
