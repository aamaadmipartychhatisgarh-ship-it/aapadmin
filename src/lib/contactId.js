// A contact id is a positive whole number and NOTHING else. MariaDB compares an integer column with a string by casting the string, so a
// loosely formatted id such as "12abc", "12 ", "1e1" or "0012" would silently match contact 12 / 10 - i.e. open (or edit / delete) a
// DIFFERENT contact than the one that was asked for. Every route and the client parse the id here first and refuse anything else.
// Returns the id as a number, or null when the value is not a clean positive integer.
export function parseContactId(v) {
  if (typeof v === "number") return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  return /^[1-9]\d{0,14}$/.test(v) ? Number(v) : null;
}
