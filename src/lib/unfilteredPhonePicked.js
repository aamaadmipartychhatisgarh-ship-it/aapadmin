// The ONLY options offered (and accepted) under Phone Picked on an Unfiltered Call. They are stored in the
// existing sentiment fields (unfiltered_call_logs.sentiment / unfiltered_contacts.call_sentiment) - no new field.
// Older saved sentiment values are left untouched and still display.
export const PHONE_PICKED_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "not_active", label: "Not Active" },
];
export const PHONE_PICKED_VALUES = PHONE_PICKED_OPTIONS.map((o) => o.value);
const LEGACY = { positive: "Positive", supporter: "Supporter", neutral: "Neutral", negative: "Negative", opponent: "Opponent", not_supporter: "Not a Supporter", wrong_number: "Wrong Number" };
export const phonePickedLabel = (v) => PHONE_PICKED_OPTIONS.find((o) => o.value === v)?.label || LEGACY[v] || v || null;
