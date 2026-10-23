// Follow-up reminder date maths, in the application timezone (Asia/Kolkata) —
// never the server's own zone, so a UTC host still flips the day at IST midnight.
export const APP_TZ = "Asia/Kolkata";

// Today's calendar date in the app timezone as YYYY-MM-DD.
export function todayInAppTz(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// YYYY-MM-DD + n days (pure calendar arithmetic, so month-end / year-end / leap
// days roll over correctly).
export function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// The Follow-up Date that is "tomorrow" right now: records with exactly this date
// are the ones to remind about today.
export function reminderTargetDate(now = new Date()) {
  return addDaysYmd(todayInAppTz(now), 1);
}
