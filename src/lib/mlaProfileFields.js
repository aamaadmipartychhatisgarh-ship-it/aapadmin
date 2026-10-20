// The ONE list of MLA Profile fields (la_mla_profiles), grouped as the MLA
// Profile form groups them. The form's empty state and the Dashboard → Assembly
// → Open view both read this list, so a field added here shows up in the Open
// view automatically instead of being silently left out.
//
// kind drives display only:
//   text   — plain value          long  — free text, wrapped (multiline kept)
//   number — integer              votes — integer, grouped digits
//   date   — calendar date        party — party name (+ logo)
//   age    — derived from date_of_birth (server-computed `age`)
//   voter  — read-only Voter Master value from the assembly (not stored on the MLA)
//   margin — derived Winning Margin (server-computed competitor_margin)
// form: false marks values that are shown but never entered in the form.
export const MLA_PROFILE_SECTIONS = [
  {
    title: "Personal details",
    fields: [
      { key: "name", label: "Full Name", kind: "text" },
      { key: "phone", label: "Phone", kind: "text" },
      { key: "party", label: "Party", kind: "party" },
      { key: "date_of_birth", label: "Date of Birth", kind: "date" },
      { key: "age", label: "Age", kind: "age", form: false },
      { key: "caste", label: "Caste", kind: "text" },
      { key: "net_worth", label: "Net Worth", kind: "text" },
      { key: "criminal_cases", label: "Criminal Cases", kind: "number" },
      { key: "address", label: "Address", kind: "long", full: true },
    ],
  },
  {
    title: "Political / Election details",
    fields: [
      { key: "times_won", label: "Times Won", kind: "number" },
      { key: "times_contested", label: "Times Contested", kind: "number" },
      { key: "largest_winning_margin", label: "Largest Winning Margin", kind: "votes" },
      { key: "previous_winning_margin", label: "Previous Winning Margin", kind: "votes" },
      { key: "party_won_from", label: "Party Won From", kind: "party" },
      { key: "party_defeated", label: "Party Defeated", kind: "party" },
    ],
  },
  {
    title: "Voter data · from Voter Master",
    fields: [
      { key: "total_voters", label: "Total Voter", kind: "voter", form: false },
      { key: "male_voters", label: "Male Voter", kind: "voter", form: false },
      { key: "female_voters", label: "Female Voter", kind: "voter", form: false },
    ],
  },
  {
    title: "Election result",
    fields: [
      { key: "mla_votes", label: "MLA Total Votes", kind: "votes" },
      { key: "competitor1_name", label: "Competitor 1 Name", kind: "text" },
      { key: "competitor1_party", label: "Competitor 1 Party", kind: "party" },
      { key: "competitor1_votes", label: "Competitor 1 Votes", kind: "votes" },
      { key: "competitor2_name", label: "Competitor 2 Name", kind: "text" },
      { key: "competitor2_party", label: "Competitor 2 Party", kind: "party" },
      { key: "competitor2_votes", label: "Competitor 2 Votes", kind: "votes" },
      { key: "competitor3_name", label: "Competitor 3 Name", kind: "text" },
      { key: "competitor3_party", label: "Competitor 3 Party", kind: "party" },
      { key: "competitor3_votes", label: "Competitor 3 Votes", kind: "votes" },
      { key: "competitor_margin", label: "Winning Margin", kind: "margin", form: false },
    ],
  },
];

export const MLA_PROFILE_FIELDS = MLA_PROFILE_SECTIONS.flatMap((s) => s.fields);

// Empty MLA Profile form state: the photo plus every enterable field.
export const EMPTY_MLA_PROFILE = Object.fromEntries(
  [["photo_url", ""], ...MLA_PROFILE_FIELDS.filter((f) => f.form !== false).map((f) => [f.key, ""])]
);
