// Pure date helpers (safe on server and client) for Followers Growth. Dates are plain YYYY-MM-DD strings in the application's own
// time zone (India, Asia/Kolkata), so "today", the presets and the stored snapshot dates all agree whatever the machine's zone is.
export const APP_TZ = "Asia/Kolkata";
export function todayIST(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export const isIsoDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00Z").getTime()) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
// End date minus N calendar months, day clamped to the target month's length (31 Mar - 1 month = 28/29 Feb).
export function monthsBefore(endIso, n) {
  const [y, m, d] = endIso.split("-").map(Number);
  const total = y * 12 + (m - 1) - n;
  const ty = Math.floor(total / 12), tm = total % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
export const fmtDMY = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
