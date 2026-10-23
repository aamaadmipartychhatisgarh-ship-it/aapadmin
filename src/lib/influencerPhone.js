import { query } from "@/lib/db";
import { getInfluencerColumns } from "@/lib/influencerSchema";
import { influencerPhoneKey } from "@/lib/influencerColumns";

// Duplicate-phone rule for Influencers. The canonical key is influencerPhoneKey
// (digits only, last 10 when there are 10+: "+91 98765 43210", "09876543210" and
// "9876543210" are the same number) — the same key the bulk import uses.
import { DUPLICATE_PHONE_MESSAGE } from "@/lib/influencerMessages";
export { DUPLICATE_PHONE_MESSAGE };

// The OTHER influencer (id <> excludeId) holding this phone, or null. Uses the
// indexed phone_key column; if that column could not be added on this deployment
// (no ALTER privilege) it falls back to comparing every stored phone.
export async function findInfluencerByPhone(phone, excludeId = null) {
  const key = influencerPhoneKey(phone);
  if (!key) return null;
  const cols = await getInfluencerColumns();
  const ex = Number(excludeId) > 0 ? Number(excludeId) : null;
  if (cols.has("phone_key")) {
    const rows = await query(
      `SELECT id, name, phone FROM influencers WHERE phone_key = ? ${ex ? "AND id <> ?" : ""} ORDER BY id ASC LIMIT 1`,
      ex ? [key, ex] : [key]
    );
    if (rows.length) return rows[0];
  }
  // Rows that pre-date the key (or no key column): compare normalized phones.
  const rows = await query(
    `SELECT id, name, phone FROM influencers WHERE phone IS NOT NULL AND phone <> '' ${ex ? "AND id <> ?" : ""} ${cols.has("phone_key") ? "AND phone_key IS NULL" : ""} ORDER BY id ASC`,
    ex ? [ex] : []
  );
  return rows.find((r) => influencerPhoneKey(r.phone) === key) || null;
}

// A 409 body naming the existing record, so the UI can offer "View existing".
export function duplicatePhoneBody(existing) {
  return { message: DUPLICATE_PHONE_MESSAGE, duplicate: existing ? { id: existing.id, name: existing.name, phone: existing.phone } : null };
}
