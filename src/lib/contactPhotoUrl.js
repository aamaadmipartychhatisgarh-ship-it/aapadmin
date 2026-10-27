import { checkUploadExists } from "@/lib/mediaFileStore";

// What may be stored in contacts.photo_url: ONLY an upload this app itself made —
// /uploads/<uuid>.<jpg|jpeg|png|webp> — that actually exists in storage. Anything else
// (javascript: / external URLs / path tricks / a file that was never saved, which would
// otherwise become a dangling reference that "disappears") is refused.
export const PHOTO_URL_RE = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9_-]*\.(jpg|jpeg|png|webp)$/i;

// raw blank → { remove: true } (an explicit removal request; the caller decides whether the
// user may do that). Otherwise { url } or { error } (+ transient: true when storage could not
// be checked right now, so the caller can ask the user to retry instead of discarding it).
export async function validateContactPhotoUrl(raw) {
  if (raw == null || String(raw).trim() === "") return { remove: true };
  const url = String(raw).trim();
  if (url.length > 255 || !PHOTO_URL_RE.test(url)) return { error: "Invalid photo. Upload an image (JPG, PNG or WEBP) and try again." };
  const ex = await checkUploadExists(url);
  if (!ex.found) {
    return ex.errored
      ? { error: "Could not verify the photo in storage right now. Please try again.", transient: true }
      : { error: "That photo is not in storage. Please upload it again." };
  }
  return { url };
}

// A GENERAL contact edit (address, designation, ...) must never touch the photo, except to
// attach a photo the user just uploaded in the same form. A form is a snapshot taken when it
// was opened, so a stale copy must not revert a photo that was replaced in the meantime:
//   • no photo_url / blank / same as now           → leave the photo alone
//   • a different, valid, stored photo_url
//       – with photo_url_prev (the value the form was opened with): applied only if the
//         contact STILL has that value (compare-and-set), else ignored
//       – without photo_url_prev (older clients): applied only if the contact has no photo
// Returns { set: url|null, ignored: bool, error?: string }.
export async function photoForGeneralEdit(data, currentPhoto) {
  if (!data || !("photo_url" in data)) return { set: null, ignored: false };
  const v = await validateContactPhotoUrl(data.photo_url);
  if (v.remove) return { set: null, ignored: false };      // blank never removes
  if (v.error) return { set: null, ignored: true };       // unusable value: keep what is there
  if (v.url === (currentPhoto || null)) return { set: null, ignored: false };
  const cur = currentPhoto || null;
  const prevGiven = "photo_url_prev" in data;
  const allowed = prevGiven ? cur === (data.photo_url_prev || null) : !cur;
  return allowed ? { set: v.url, ignored: false } : { set: null, ignored: true };
}
