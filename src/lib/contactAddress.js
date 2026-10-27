// How a GENERAL contact edit may change the Address. The edit forms are snapshots taken when
// they were opened, so a form that was NOT used to edit the address (another field was changed)
// must never write its stale copy back over a newer address, and an address is only removed
// when the user deliberately emptied it.
//
//   data.address       — the form's address
//   data.address_prev  — the address the form was OPENED with (sent by the app's forms)
//
// Returns { value } to write (a string, or null to clear), or { skip: true } (+ conflict: true when
// the stored address changed after the form was opened, so the user's edit is NOT applied over it).
const norm = (v) => String(v ?? "").replace(/\r\n?/g, "\n").trim();
// "Same address" ignores line breaks / repeated spaces: a single-line input flattens a multi-line address to
// spaces, which must not look like an edit (and silently reformat the stored address).
const key = (v) => norm(v).replace(/\s+/g, " ");

export function addressForGeneralEdit(data, currentAddress, canClear) {
  if (!data || !("address" in data)) return { skip: true };
  const next = norm(data.address);
  const cur = norm(currentAddress);
  if (key(next) === key(cur)) return { skip: true };                       // nothing to change
  if ("address_prev" in data) {
    const prev = norm(data.address_prev);
    if (key(next) === key(prev)) return { skip: true };                    // the user did not edit it: stale copy
    if (key(prev) !== key(cur)) return { skip: true, conflict: true };     // someone changed it since the form opened
    if (!next) return canClear ? { value: null } : { skip: true }; // explicit clear — managers only
    return { value: next };
  }
  // Older clients send no baseline: a new non-blank value is applied (as before) but a blank one is
  // never treated as an intentional clear.
  if (!next) return { skip: true };
  return { value: next };
}
