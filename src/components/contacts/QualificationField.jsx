"use client";

import { QUALIFICATIONS, EDUCATION_LEVELS } from "@/lib/qualificationOptions";

// Qualification field for the Add / Edit contact forms.
//   Qualification: Illiterate | Literate
//   Education level (only when Literate): 8th · 10th · 12th · Graduate · Post Graduate or Above
// Choosing Illiterate hides the education options AND clears any previously selected
// level, so a stale value is never kept or sent.
export default function QualificationField({ qualification, educationLevel, onChange, className = "" }) {
  const sel = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white";
  return (
    <div className={`space-y-2 ${className}`}>
      <div>
        <label htmlFor="contact-qualification" className="block text-xs font-semibold text-gray-500 mb-1">Qualification</label>
        <select
          id="contact-qualification" className={sel} value={qualification || ""}
          onChange={(e) => {
            const q = e.target.value;
            // Leaving "Literate" always drops the education level.
            onChange({ qualification: q, education_level: q === "literate" ? (educationLevel || "") : "" });
          }}
        >
          <option value="">Select qualification</option>
          {QUALIFICATIONS.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
        </select>
      </div>
      {qualification === "literate" && (
        <div>
          <label htmlFor="contact-education-level" className="block text-xs font-semibold text-gray-500 mb-1">Education level</label>
          <select
            id="contact-education-level" className={sel} value={educationLevel || ""}
            onChange={(e) => onChange({ qualification: "literate", education_level: e.target.value })}
          >
            <option value="">Select education level</option>
            {EDUCATION_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
