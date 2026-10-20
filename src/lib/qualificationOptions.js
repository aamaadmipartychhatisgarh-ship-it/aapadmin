// Pure (client-safe) Qualification options + label helper — shared by the forms, the list
// and the server validation in contactQualification.js.
export const QUALIFICATIONS = [
  { value: "illiterate", label: "Illiterate" },
  { value: "literate", label: "Literate" },
];
export const EDUCATION_LEVELS = [
  { value: "8th", label: "8th" },
  { value: "10th", label: "10th" },
  { value: "12th", label: "12th" },
  { value: "graduate", label: "Graduate" },
  { value: "post_graduate", label: "Post Graduate or Above" },
];
export const _Q = new Set(QUALIFICATIONS.map((x) => x.value));
export const _E = new Set(EDUCATION_LEVELS.map((x) => x.value));

// "Literate – 12th", "Literate", "Illiterate" or "" — one place for the display text.
export function qualificationLabel(qualification, educationLevel) {
  const q = QUALIFICATIONS.find((x) => x.value === qualification);
  if (!q) return "";
  if (q.value !== "literate") return q.label;
  const e = EDUCATION_LEVELS.find((x) => x.value === educationLevel);
  return e ? `${q.label} – ${e.label}` : q.label;
}

