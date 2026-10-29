// Phone Picked on an Unfiltered Call: Active, or Not Active -> Wrong Number | Opponent | Not Interested. Stored in the
// existing sentiment fields (unfiltered_call_logs.sentiment / unfiltered_contacts.call_sentiment) - no new field.
// "not_active" alone is a LEGACY value (saved before the three reasons existed): it still displays and filters, but a new
// call must carry one of the four values below. Older sentiment values are left untouched and still display.
export const PHONE_PICKED_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "wrong_number", label: "Not Active · Wrong Number" },
  { value: "opponent", label: "Not Active · Opponent" },
  { value: "not_interested", label: "Not Active · Not Interested" },
];
export const PHONE_PICKED_VALUES = PHONE_PICKED_OPTIONS.map((o) => o.value);
// Not Active reasons (the second step of the form)
export const NOT_ACTIVE_REASONS = PHONE_PICKED_OPTIONS.filter((o) => o.value !== "active").map((o) => ({ value: o.value, label: o.label.replace("Not Active · ", "") }));
const LEGACY = { not_active: "Not Active", positive: "Positive", supporter: "Supporter", neutral: "Neutral", negative: "Negative", not_supporter: "Not a Supporter" };
export const phonePickedLabel = (v) => PHONE_PICKED_OPTIONS.find((o) => o.value === v)?.label || LEGACY[v] || v || null;

// Statuses a Super Admin / Supervisor can filter the Unfiltered Contact List by (saved status of the record).
export const UNFILTERED_STATUS_FILTERS = [
  { value: "active", label: "Active" },
  { value: "not_active", label: "Not Active" },
  { value: "wrong_number", label: "Wrong Number" },
  { value: "opponent", label: "Opponent" },
  { value: "not_interested", label: "Not Interested" },
  { value: "not_picked", label: "Not Picked" },
  { value: "not_in_service", label: "Not in Service" },
  { value: "switched_off", label: "Switched Off" },
  { value: "incoming_off", label: "Incoming Off" },
];
// Calling Statuses no longer offered (or accepted) on Unfiltered Calls. Regular Calls and every other module keep them, and
// historical Unfiltered calls that already carry them are left untouched.
export const UNFILTERED_HIDDEN_STATUSES = ["Rudely Behaved", "Busy"];
// Statuses that take a Follow-up date (Busy was added earlier; kept so existing Busy follow-ups still work).
export const UNFILTERED_FOLLOWUP_STATUSES = ["Busy", "Not Picked", "Not in Service", "Switched Off", "Incoming Off"];

// Outcomes that COMPLETE an Unfiltered call (any other status leaves it pending for a retry).
export const UNFILTERED_FINAL_STATUSES = ["Phone Picked", "Wrong Number", "Rudely Behaved"];
