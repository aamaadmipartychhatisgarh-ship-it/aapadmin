import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import { checkUploadExists } from "@/lib/mediaFileStore";

// Contact photo audit / repair (Admin).
//   GET  → a NON-destructive report: how many contact photo references point at a
//          file that still exists (valid), are genuinely missing (dead), or could
//          not be verified right now (indeterminate).
//   POST → repairs: clears ONLY the references whose file is definitively gone
//          (found=false AND no lookup error), so a still-recoverable photo is never
//          touched and a reference is never dropped over a transient error
//          (§4, §5, §11). Photos whose files still exist keep their valid URL and
//          continue to display — nothing to re-upload.
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };
const MAX = 20000;

async function guard() {
  const session = await getServerSession(authOptions);
  if (!(await pageAllowed(session, "contacts", session && isAdmin(session)))) {
    return { error: NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: NO_STORE }) };
  }
  return { session };
}

async function scan(apply) {
  const rows = await query(
    `SELECT id, photo_url FROM contacts
      WHERE photo_url IS NOT NULL AND photo_url <> '' AND photo_url LIKE '/uploads/%'
      LIMIT ${MAX}`
  );
  let valid = 0, dead = 0, indeterminate = 0, cleared = 0;
  for (const r of rows) {
    // eslint-disable-next-line no-await-in-loop
    const { found, errored } = await checkUploadExists(r.photo_url);
    if (found) { valid += 1; continue; }
    if (errored) { indeterminate += 1; continue; }
    dead += 1;
    if (apply) {
      // eslint-disable-next-line no-await-in-loop
      await query("UPDATE contacts SET photo_url = NULL WHERE id = ? AND photo_url = ?", [r.id, r.photo_url]).catch(() => {});
      cleared += 1;
    }
  }
  return { checked: rows.length, valid, dead, indeterminate, cleared, capped: rows.length >= MAX };
}

export async function GET() {
  try {
    const { error } = await guard();
    if (error) return error;
    const result = await scan(false);
    return NextResponse.json({ mode: "report", ...result }, { headers: NO_STORE });
  } catch (err) {
    console.error("[contacts] photo-audit GET error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST() {
  try {
    const { error } = await guard();
    if (error) return error;
    const result = await scan(true);
    return NextResponse.json({ mode: "repair", ...result }, { headers: NO_STORE });
  } catch (err) {
    console.error("[contacts] photo-audit POST error:", err?.message || err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: NO_STORE });
  }
}
