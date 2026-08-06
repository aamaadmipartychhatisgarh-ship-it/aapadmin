import { NextResponse } from "next/server";

// Turn a DB/driver error from a contact create/update into a MEANINGFUL API
// response — the full exception is logged server-side (never sent to the UI),
// and the client gets a clear, actionable message instead of a bare
// "Internal Server Error". Used by both the admin and supervisor contact POSTs.
export function contactWriteError(err, tag = "contact write") {
  console.error(`${tag} error:`, err); // full stack stays on the server
  const map = {
    ER_DUP_ENTRY: [409, "A contact with this mobile number already exists."],
    ER_NO_REFERENCED_ROW: [400, "Invalid selection — please re-check the designation, district or caller."],
    ER_NO_REFERENCED_ROW_2: [400, "Invalid selection — please re-check the designation, district or caller."],
    ER_BAD_NULL_ERROR: [400, "A required field is missing."],
    ER_DATA_TOO_LONG: [400, "One of the values is too long — please shorten it."],
    ER_TRUNCATED_WRONG_VALUE_FOR_FIELD: [400, "One of the values has the wrong format."],
    ER_BAD_FIELD_ERROR: [500, "The contacts table is missing a column on this server. Please contact an admin."],
  };
  const [status, message] = map[err?.code] || [500, "Could not save the contact. Please try again."];
  return NextResponse.json({ message }, { status });
}
