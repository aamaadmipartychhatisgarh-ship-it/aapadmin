// MEMBER status & follow-up workflow (Regular Calls). Only a contact whose Designation is "Member" gets it; the options are
// stored in the existing calls fields (status, sentiment varchar, follow-up date/time) - no new table or column.
//   Phone Picked  -> Active, or Not Active -> Wrong Number | Opponent | Not Interested   (stored in `sentiment`)
//   Not Picked / Not in Service / Switched Off / Incoming Off -> optional Follow-up date
//   Wrong Number  -> existing Wrong Number workflow
export const MEMBER_DESIGNATION = "member";
export const MEMBER_PICKED = [
  { value: "active", label: "Active" },
  { value: "wrong_number", label: "Not Active · Wrong Number" },   // existing Wrong Number sentiment -> Wrong Number page
  { value: "member_opponent", label: "Not Active · Opponent" },    // marked wrong (reason Other, note Opponent) -> Wrong Number page
  { value: "not_interested", label: "Not Active · Not Interested" }, // Not Interested page
];
export const MEMBER_PICKED_VALUES = MEMBER_PICKED.map((o) => o.value);
export const MEMBER_ONLY_SENTIMENTS = ["active", "not_active", "member_opponent", "not_interested"]; // not available to other designations
// ...but of those, Rudely Behaved and Busy are NOT offered to a Member in My Workspace (nor accepted for a Member contact's call);
// Not in Service and Wrong Number stay. Historical calls carrying them are untouched.
export const MEMBER_HIDDEN_STATUSES = ["Rudely Behaved", "Busy"];
export const MEMBER_FOLLOWUP_STATUSES = ["Not Picked", "Not in Service", "Switched Off", "Incoming Off"];
// Calling Status options offered only for a Member on Regular Calls (hidden for every other designation, and refused by POST /api/calls).
// Historical calls that already carry these statuses are untouched.
export const MEMBER_ONLY_STATUSES = ["Not in Service", "Rudely Behaved", "Busy", "Wrong Number"];
export const memberPickedLabel = (v) => MEMBER_PICKED.find((o) => o.value === v)?.label || null;
export const hasMemberName = (csv) => String(csv || "").split(",").some((n) => isMemberName(n));
export const isMemberName = (n) => String(n || "").trim().toLowerCase() === MEMBER_DESIGNATION;

// Wrong Number reasons offered for a MEMBER on Regular Calls - exactly these two (existing wrong_number_reason values, so both keep
// their existing workflow); every other designation keeps the full list.
export const MEMBER_WRONG_REASONS = [
  { value: "invalid_number", label: "Invalid/Wrong Number" },
  { value: "belongs_to_someone_else", label: "Belongs to Someone Else" },
];
export const MEMBER_WRONG_REASON_VALUES = MEMBER_WRONG_REASONS.map((o) => o.value);
