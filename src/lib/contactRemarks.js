// How a GENERAL contact edit may change the Remark / Notes (contacts.remarks). The edit forms are snapshots taken when they
// were opened, so:
//   - a request that OMITS `remarks` never touches the stored value;
//   - a form whose Remark was NOT edited (remarks == remarks_prev) never writes its - possibly stale or empty - copy back;
//   - a Remark someone else changed after the form was opened is NOT overwritten (reported as a conflict);
//   - only a Remark the user really changed is written - including an explicit clear (the box emptied and saved), which
//     is how the user deliberately removes it.
//
//   data.remarks       - the form's Remark
//   data.remarks_prev  - the Remark the form was OPENED with (sent by the app's forms)
//
// Returns { value } to write (the text exactly as typed, or null to clear), or { skip: true } (+ conflict: true when the stored
// Remark changed after the form was opened). Wording, punctuation and inner spacing are never altered; line endings are only
// compared (not rewritten) so a browser's CRLF does not look like an edit.
const lf = (v) => String(v ?? "").replace(/\r\n?/g, "\n");

export function remarksForGeneralEdit(data, currentRemarks) {
  if (!data || !("remarks" in data)) return { skip: true };
  const next = lf(data.remarks);
  const cur = lf(currentRemarks);
  if (next === cur) return { skip: true };                                  // nothing to change
  if ("remarks_prev" in data) {
    const prev = lf(data.remarks_prev);
    if (next === prev) return { skip: true };                               // the user did not edit it: stale copy
    if (prev !== cur) return { skip: true, conflict: true };                // someone changed it since the form opened
    return { value: next === "" ? null : String(data.remarks) };            // edited (a blank = the user cleared it)
  }
  // Older clients send no baseline: a non-blank value is applied (as before) but a blank one is never an intentional clear.
  if (next === "") return { skip: true };
  return { value: String(data.remarks) };
}
