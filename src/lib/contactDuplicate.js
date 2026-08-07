import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// Single source of truth for the duplicate-mobile message so every add/edit
// path (admin + supervisor) shows exactly the same text the UI expects.
export const DUPLICATE_PHONE_MESSAGE = "This mobile number is already registered.";

// True when another contact already has this mobile number. `exceptId` lets an
// EDIT keep the contact's own number (it only flags a clash with a DIFFERENT
// contact). Matches the exact trimmed string, consistent with the uniq_phone
// unique index that also enforces this at the DB layer.
export async function phoneAlreadyRegistered(phone, exceptId = null) {
  const trimmed = String(phone ?? "").trim();
  if (!trimmed) return false;
  const rows = exceptId != null
    ? await query("SELECT id FROM contacts WHERE phone_number = ? AND id <> ? LIMIT 1", [trimmed, exceptId])
    : await query("SELECT id FROM contacts WHERE phone_number = ? LIMIT 1", [trimmed]);
  return rows.length > 0;
}

// The 409 response used whenever a duplicate mobile is detected.
export function duplicatePhoneResponse() {
  return NextResponse.json({ message: DUPLICATE_PHONE_MESSAGE }, { status: 409 });
}
