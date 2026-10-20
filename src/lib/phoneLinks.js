// Safe Call / SMS / WhatsApp links for an Indian mobile number (client + server safe).
// A number is usable ONLY when it reduces to a real 10-digit Indian mobile
// (starts 6–9). Accepted input forms: "98765 43210", "+91-98765-43210",
// "919876543210", "09876543210". Anything else (too short/long, landline-style,
// letters only, empty) → null, so no link is ever built from a wrong number.
export function normalizeIndianMobile(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

// { mobile, display, tel, sms, whatsapp } for a usable number, or null.
export function phoneActionLinks(raw) {
  const m = normalizeIndianMobile(raw);
  if (!m) return null;
  return {
    mobile: m,
    display: `+91 ${m.slice(0, 5)} ${m.slice(5)}`,
    tel: `tel:+91${m}`,
    sms: `sms:+91${m}`,
    whatsapp: `https://wa.me/91${m}`,
  };
}
