import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getPool } from "@/lib/db";
import { guard, noStore } from "@/lib/leaderAssessmentGuard";
import { syncAssemblies } from "@/lib/leaderAssessment";
import { parseAndValidatePolling } from "@/lib/pollingImport";

export const dynamic = "force-dynamic";

// POST /api/leader-assessment/polling/import — bulk import the Polling Station
// Master (Voter Master): one aggregate row per master Assembly.
//   ?dry_run=1  parse + validate only, write NOTHING (drives the preview).
//   (default)   commit — chunked upsert inside ONE transaction.
//
// Authorization is the SAME gate as the single-record editor
// (guard + polling_master page key): oversight OR a Super-Admin-granted
// polling_master user. An unauthorized caller can neither preview nor import.
//
// Master Data is the single source of truth — assemblies are matched, never
// created, and NOTHING is ever deleted. An assembly already carrying polling
// figures is UPDATED (la_polling_data has UNIQUE assembly_id), mirroring the
// single editor's upsert; the preview shows the add/update split so the admin
// consciously approves overwriting existing figures before committing.
const CHUNK = 200;

export async function POST(req) {
  const { error } = await guard({ allowPageKeys: ["polling_master"] });
  if (error) return error;

  try {
    // Keep the mirror in step with Master Data before matching, so a freshly
    // added master assembly is importable immediately (same as every other
    // polling route).
    await syncAssemblies();

    const { searchParams } = new URL(req.url);
    const dryRun = searchParams.get("dry_run") === "1";

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ message: "No file uploaded." }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    let wb;
    try {
      wb = XLSX.read(buf, { type: "buffer" });
    } catch {
      return NextResponse.json({ message: "Could not read the file. Use .xlsx, .xls, or .csv." }, { status: 400 });
    }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return NextResponse.json({ message: "The file has no sheets." }, { status: 400 });
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    const parsed = await parseAndValidatePolling(rows);
    if (parsed.error) return NextResponse.json({ message: parsed.error }, { status: 400 });

    const { validRows, rowErrors, unmatchedAssemblies, summary } = parsed;

    const respond = (added, updated) => ({
      total_rows: summary.total_rows,
      added,
      updated,
      duplicates_in_file: summary.duplicates_in_file,
      invalid: summary.invalid,
      unmatched_assemblies: unmatchedAssemblies,
      row_errors: rowErrors,
    });

    if (dryRun) {
      return NextResponse.json(
        { ...respond(summary.to_add, summary.to_update), dry_run: true },
        { headers: noStore }
      );
    }

    if (validRows.length === 0) {
      return NextResponse.json(respond(0, 0), { headers: noStore });
    }

    let added = 0, updated = 0;
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      for (let i = 0; i < validRows.length; i += CHUNK) {
        const chunk = validRows.slice(i, i + CHUNK);
        // Upsert la_polling_data. UNIQUE(assembly_id) makes ON DUPLICATE KEY
        // UPDATE overwrite the existing figures (never a second row, never a
        // delete). new-vs-update is counted from the pre-read classification,
        // not affectedRows (which is unreliable in a batched upsert).
        const placeholders = chunk.map(() => "(?,?,?,?,?)").join(",");
        const vals = [];
        for (const r of chunk) {
          vals.push(r.assembly_id, r.total_booths, r.total_voters, r.male_voters, r.female_voters);
          if (r.isUpdate) updated++; else added++;
        }
        await conn.query(
          `INSERT INTO la_polling_data (assembly_id, total_booths, total_voters, male_voters, female_voters)
           VALUES ${placeholders}
           ON DUPLICATE KEY UPDATE
             total_booths = VALUES(total_booths),
             total_voters = VALUES(total_voters),
             male_voters = VALUES(male_voters),
             female_voters = VALUES(female_voters)`,
          vals
        );
        // Mirror the headline figures back onto la_assemblies so surfaces that
        // read total_voters/total_booths stay consistent with the master —
        // exactly what the single-record PUT does, one statement per assembly.
        for (const r of chunk) {
          await conn.query(
            "UPDATE la_assemblies SET total_voters = ?, total_booths = ? WHERE id = ?",
            [r.total_voters, r.total_booths, r.assembly_id]
          );
        }
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    return NextResponse.json(respond(added, updated), { headers: noStore });
  } catch (e) {
    console.error("[LA] polling import:", e);
    return NextResponse.json({ message: "Import failed. Please try again." }, { status: 500 });
  }
}
