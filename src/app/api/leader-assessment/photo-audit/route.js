import { NextResponse } from "next/server";
import { readFile, access } from "fs/promises";
import path from "path";
import { query } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";

export const dynamic = "force-dynamic";

// Photo persistence audit + repair for Leader Assessment (MLA + Candidate photos).
//
// WHY: photos uploaded BEFORE profile uploads became durable were written only to
// public/uploads on disk, which this host does not persist across redeploys — so
// after a redeploy those files 404 and their profiles show initials instead of a
// photo, even though the DB still holds the photo_url. This endpoint does NOT
// invent or delete anything: it reads every stored photo reference, reports where
// its bytes actually live (durable DB store, legacy tables, disk, or nowhere),
// and can backfill any file still present on disk INTO the durable store so it
// stops disappearing.
//
// GET  → a full report (no writes).
// POST { action: "backfill_disk" } → copy every disk-only photo into media_files
//        (durable). Never touches the DB photo_url references or existing blobs.

const UPLOAD_DIR = () => path.join(process.cwd(), "public", "uploads");

// Extract the { id, name, ext } of a stored /uploads/<uuid>.<ext> reference.
function parseRef(url) {
  if (!url || typeof url !== "string") return null;
  const s = url.trim();
  if (!s) return null;
  const name = path.basename(s);
  if (!name || name.includes("..")) return null;
  const ext = (name.split(".").pop() || "").toLowerCase();
  const id = ext ? name.slice(0, name.length - ext.length - 1) : name;
  if (!id) return null;
  return { id, name, ext, url: s, external: /^https?:\/\//i.test(s) };
}

async function existsOnDisk(name) {
  try { await access(path.join(UPLOAD_DIR(), name)); return true; }
  catch { return false; }
}

// Load the id set of a DB-backed photo store (missing table → empty set).
async function idSet(table, ids) {
  if (!ids.length) return new Set();
  try {
    const rows = await query(`SELECT id FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    return new Set(rows.map((r) => String(r.id)));
  } catch { return new Set(); }
}

async function collectRefs() {
  const out = [];
  const push = (kind, rows) => {
    for (const r of rows) {
      if (!r.photo_url) continue;
      const ref = parseRef(r.photo_url);
      out.push({ kind, record_id: r.id, name: r.name, photo_url: r.photo_url, ref });
    }
  };
  const mlas = await query("SELECT id, name, photo_url FROM la_mla_profiles WHERE photo_url IS NOT NULL AND TRIM(photo_url) <> ''");
  const cands = await query("SELECT id, name, photo_url FROM la_aap_candidates WHERE photo_url IS NOT NULL AND TRIM(photo_url) <> ''");
  push("mla", mlas);
  push("candidate", cands);
  return out;
}

// Classify every reference by where its bytes actually live.
async function classify(refs) {
  const ids = [...new Set(refs.map((r) => r.ref?.id).filter(Boolean))];
  const [inMedia, inUser, inWorker] = await Promise.all([
    idSet("media_files", ids),
    idSet("user_photos", ids),
    idSet("worker_photos", ids),
  ]);
  const items = [];
  for (const r of refs) {
    const id = r.ref?.id;
    let where = "missing";
    let onDisk = false;
    if (r.ref?.external) where = "external";
    else if (id && inMedia.has(id)) where = "media_files";
    else if (id && inUser.has(id)) where = "user_photos";
    else if (id && inWorker.has(id)) where = "worker_photos";
    if (r.ref?.name) onDisk = await existsOnDisk(r.ref.name);
    // Resolvable = the serving route can return bytes (any DB store OR disk OR
    // an external URL). "missing" only when it's in no store and not on disk.
    const resolvable = where !== "missing" || onDisk || r.ref?.external;
    items.push({ ...r, where, onDisk, resolvable });
  }
  return items;
}

export async function GET() {
  const { error } = await guard();
  if (error) return error;
  try {
    const refs = await collectRefs();
    const items = await classify(refs);
    const summary = {
      total_references: items.length,
      resolvable: items.filter((i) => i.resolvable).length,
      missing: items.filter((i) => !i.resolvable).length,
      by_store: {
        media_files: items.filter((i) => i.where === "media_files").length,
        user_photos: items.filter((i) => i.where === "user_photos").length,
        worker_photos: items.filter((i) => i.where === "worker_photos").length,
        external: items.filter((i) => i.where === "external").length,
        disk_only: items.filter((i) => i.where === "missing" && i.onDisk).length,
        nowhere: items.filter((i) => !i.resolvable).length,
      },
      // Disk-only files are the ones that WILL vanish on the next redeploy but can
      // be made durable right now via POST { action: "backfill_disk" }.
      backfillable_from_disk: items.filter((i) => i.where === "missing" && i.onDisk).length,
    };
    // List the genuinely-missing (no bytes anywhere) so an admin can see exactly
    // which profiles need a re-upload — nothing is guessed or deleted.
    const missing = items.filter((i) => !i.resolvable)
      .map((i) => ({ kind: i.kind, record_id: i.record_id, name: i.name, photo_url: i.photo_url }));
    return NextResponse.json({ summary, missing }, { headers: noStore });
  } catch (e) {
    console.error("[LA] photo-audit GET:", e);
    return NextResponse.json({ message: "Photo audit failed." }, { status: 500 });
  }
}

export async function POST(req) {
  const { error } = await guard();
  if (error) return error;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action !== "backfill_disk") {
      return NextResponse.json({ message: "Unknown action." }, { status: 400 });
    }
    // Ensure the durable store exists.
    const { ensureMediaFilesTable, saveMediaFile, getMediaFile } = await import("@/lib/mediaFileStore");
    await ensureMediaFilesTable();

    const refs = await collectRefs();
    const items = await classify(refs);
    // Copy every disk-present file that isn't already durable into media_files.
    const targets = items.filter((i) => i.onDisk && i.where !== "media_files" && i.ref?.id);
    const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
    let backfilled = 0, skipped = 0, failed = 0;
    const seen = new Set();
    for (const it of targets) {
      const { id, name, ext } = it.ref;
      if (seen.has(id)) { skipped++; continue; }
      seen.add(id);
      try {
        if (await getMediaFile(id)) { skipped++; continue; } // already durable
        const buf = await readFile(path.join(UPLOAD_DIR(), name));
        const ok = await saveMediaFile({ id, mimeType: MIME[ext] || "image/jpeg", ext: ext || "jpg", size: buf.length, data: buf, userId: null });
        if (ok) backfilled++; else failed++;
      } catch (e) {
        failed++;
        console.error("[LA] photo-audit backfill:", name, e?.code || e?.message);
      }
    }
    return NextResponse.json(
      { ok: true, backfilled, skipped, failed, message: `Made ${backfilled} disk photo(s) durable. ${failed} could not be read.` },
      { headers: noStore }
    );
  } catch (e) {
    console.error("[LA] photo-audit POST:", e);
    return NextResponse.json({ message: "Photo repair failed." }, { status: 500 });
  }
}
