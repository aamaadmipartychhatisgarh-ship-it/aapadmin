// Login credentials for the common Worker & Voter Registration link.
//
//   Username  = the karyakarta's Name (whitespace tidied, never altered beyond
//               trimming/collapsing spaces).
//   Password  = LAST 4 letters of the Name (UPPERCASE) + FIRST 4 digits of the
//               phone number.  e.g. "Rahul Sharma" + "9876543210" → "ARMA9876".
//
// "Letters" means Unicode letters only (spaces, digits and punctuation are
// ignored), so Hindi names work too — .toUpperCase() is a harmless no-op on
// scripts without case. A name needs at least 4 usable letters and the phone at
// least 4 digits; otherwise NO credential is generated (the caller reports the
// error) rather than silently producing an invalid/empty password.

// Collapse internal runs of whitespace and trim the ends — the stored Name and
// the username stay human-readable without changing the actual characters.
export function tidyName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

// Unicode letters of the name, in order, with everything else removed.
function nameLetters(name) {
  return String(name || "").replace(/[^\p{L}]/gu, "");
}

// Build { username, password } for a Name + phone, or { error } when the inputs
// cannot produce a valid credential. The password is PLAINTEXT here — the caller
// hashes it before storing and only ever shows it once.
export function buildRegCredentials(name, mobile) {
  const username = tidyName(name);
  const letters = nameLetters(username);
  const digits = String(mobile || "").replace(/\D/g, "");
  if (username.length === 0) return { error: "A name is required." };
  if (letters.length < 4) {
    return { error: `"${username}" needs at least 4 letters to generate a login password.` };
  }
  if (digits.length < 4) {
    return { error: `"${username}" needs a valid phone number (at least 4 digits) to generate a password.` };
  }
  const password = letters.slice(-4).toUpperCase() + digits.slice(0, 4);
  return { username, password };
}
