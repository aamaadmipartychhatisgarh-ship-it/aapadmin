// The ONLY reasons offered (and accepted) for a Wrong Number outcome on an Unfiltered Call. The values are
// the existing wrong_number_reason values of the Contact List (contacts.wrong_number_reason), so the two
// modules share one vocabulary - nothing new is invented.
export const UNFILTERED_WRONG_REASONS = [
  { value: "belongs_to_someone_else", label: "Belongs to Someone Else" },
  { value: "invalid_number", label: "Wrong/Invalid Number" },
];
export const UNFILTERED_WRONG_REASON_VALUES = UNFILTERED_WRONG_REASONS.map((r) => r.value);
export const unfilteredWrongReasonLabel = (v) => UNFILTERED_WRONG_REASONS.find((r) => r.value === v)?.label || null;
