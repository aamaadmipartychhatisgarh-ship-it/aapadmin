// Influencer import/export columns — client + server safe (no DB access), so the
// browser pre-check reads a file with exactly the same header rules as the server.
//
// Each import field lists the header names it accepts (case / spacing /
// trailing punctuation insensitive). Name and Phone are mandatory.
export const INFLUENCER_IMPORT_FIELDS = [
  { key: "name", label: "Name", required: true, aliases: ["name", "influencer name", "full name", "person name"] },
  { key: "phone", label: "Phone", required: true, aliases: ["phone", "mobile", "mobile number", "phone number", "phone no", "mobile no", "contact no", "contact number", "whatsapp", "whatsapp number"] },
  { key: "assembly", label: "Assembly", aliases: ["assembly", "assembly name", "vidhansabha", "vidhan sabha", "assembly constituency", "constituency"] },
  { key: "address", label: "Address", aliases: ["address"] },
  { key: "age", label: "Age", aliases: ["age"] },
  { key: "caste", label: "Caste", aliases: ["caste"] },
  { key: "current_party", label: "Party", aliases: ["party", "current party"] },
  { key: "party_years", label: "Years in Party", aliases: ["years in party", "party years"] },
  { key: "political_position", label: "Political Position", aliases: ["political position"] },
  { key: "org_position", label: "Organisation Position", aliases: ["organisation position", "organization position", "org position"] },
  { key: "associated_since", label: "Associated Since", aliases: ["associated since"] },
  { key: "social_media", label: "Social Media", aliases: ["social media"] },
  { key: "team_size", label: "Team Size", aliases: ["team size"] },
  { key: "social_reach", label: "Social Reach", aliases: ["social reach"] },
  { key: "economic_status", label: "Economic Status", aliases: ["economic status"] },
  { key: "influencer_rating", label: "Influencer Rating", aliases: ["influencer rating", "rating"] },
  { key: "status", label: "Status", aliases: ["status"] },
  { key: "join_date", label: "Join Date", aliases: ["join date", "joined date", "joining date"] },
  { key: "cancelled_date", label: "Cancelled Date", aliases: ["cancelled date", "cancellation date"] },
  { key: "cancellation_remark", label: "Cancellation Remark", aliases: ["cancellation remark", "cancellation reason"] },
  { key: "joined_by_phone", label: "Joined By Phone", aliases: ["joined by phone", "joined by mobile", "joined by"] },
  { key: "remark", label: "Remark", aliases: ["remark", "remarks"] },
];

const normHeader = (h) => String(h ?? "").trim().toLowerCase().replace(/[_\s]+/g, " ").replace(/[.:*]+$/, "").trim();

// header row → { fieldKey: columnIndex } (first matching column wins).
export function mapInfluencerHeaders(headerRow) {
  const idx = {};
  (headerRow || []).forEach((h, i) => {
    const k = normHeader(h);
    if (!k) return;
    for (const f of INFLUENCER_IMPORT_FIELDS) if (idx[f.key] === undefined && f.aliases.includes(k)) idx[f.key] = i;
  });
  return idx;
}

// Canonical phone for duplicate checks: digits only, last 10 when there are 10+
// ("+91 98765 43210", "09876543210" and "9876543210" are the same number).
export function influencerPhoneKey(v) {
  const d = String(v ?? "").replace(/\D/g, "");
  if (!d) return null;
  return d.length >= 10 ? d.slice(-10) : d;
}

// A phone the Influencer module accepts (same rule as its form: 7–15 digits).
export function validInfluencerPhone(v) {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 7 && d.length <= 15;
}
