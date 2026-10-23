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
  { key: "follow_up_date", label: "Follow-up Date", aliases: ["follow-up date", "follow up date", "followup date", "follow-up", "follow up", "next follow-up date", "next follow up date"] },
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

// A stored calendar date: exactly YYYY-MM-DD, a real day, year 1900–2100.
// Returns the normalized string, or null when it is not one.
export function isoDateOrNull(v) {
  const m = String(v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (y < 1900 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? m[0] : null;
}

// A phone the Influencer module accepts (same rule as its form: 7–15 digits).
export function validInfluencerPhone(v) {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 7 && d.length <= 15;
}
