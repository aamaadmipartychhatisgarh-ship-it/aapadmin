import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { getPool } from "@/lib/db";
import * as XLSX from "xlsx";
import { parseAndValidateWorkbook } from "@/lib/workerImport";

// Contacts-only Excel/CSV import — the combined worker+contact importer this
// replaced (formerly /api/workers/import-excel) was removed along with the
// rest of Worker Management. Reuses the SAME shared parse/validate module
// (src/lib/workerImport.js — geo/name/mobile resolution is domain-neutral,
// not worker-specific) so the numbers behave identically to before; only the
// commit step changed — writes ONLY to `contacts`, never `workers`.
//
//   ?dry_run=1  parse + validate only, write nothing.
//   (default)   commit — bulk upsert into contacts, chunked.
const INSERT_CHUNK = 500;

// Resolve a free-text designation name to a designations.id, creating the
// row if it doesn't exist yet (same lookup-or-create pattern already used
// for ward names in contacts/[id]/route.js). Cached per request so a batch
// of 5,000 rows sharing 6 designations only does 6 lookups, not 5,000.
async function resolveDesignationIds(conn, names) {
  const map = new Map();
  for (const raw of names) {
    const name = String(raw || "").trim();
    if (!name || map.has(name)) continue;
    const [existing] = await conn.query("SELECT id FROM designations WHERE LOWER(name) = LOWER(?) LIMIT 1", [name]);
    if (existing.length) { map.set(name, existing[0].id); continue; }
    const [ins] = await conn.query("INSERT INTO designations (name) VALUES (?)", [name]);
    map.set(name, ins.insertId);
  }
  return map;
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    // Contacts bulk import is available to oversight roles (Super Admin + State/
    // Zone/District/Assembly admins + Supervisors) so the shared Contacts toolbar
    // works identically in both the admin and supervisor dashboards.
    if (!session || !isOversight(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const dryRun = searchParams.get("dry_run") === "1";

    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ message: "No file uploaded" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    let wb;
    try {
      wb = XLSX.read(buf, { type: "buffer" });
    } catch {
      return NextResponse.json({ message: "Could not read the file. Use .xlsx, .xls, or .csv." }, { status: 400 });
    }

    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (rows.length < 2) {
      return NextResponse.json({ message: "Sheet has no data rows." }, { status: 400 });
    }

    const parsed = await parseAndValidateWorkbook(rows);
    if (parsed.error) {
      return NextResponse.json({ message: parsed.error }, { status: 400 });
    }
    const { validRows, rowErrors, summary, totalRows, unmatchedDistricts, unmatchedAssemblies, existingNormalizedPhones } = parsed;
    // Row classification for the Total / Added / Duplicate / Invalid summary:
    //  - "duplicate" severity = same phone repeated earlier in THIS file.
    //  - "error" severity     = truly invalid (e.g. missing name).
    const withinFileDuplicates = rowErrors.filter((e) => e.severity === "duplicate").length;
    const invalidNameRows = rowErrors.filter((e) => e.severity === "error").length;

    // Rows that carry a phone (the ones we can safely de-duplicate). Rows with no
    // phone can't be matched by number and are not inserted — counted as invalid.
    const withPhone = validRows.filter((r) => r.phone);
    const noPhoneCount = validRows.length - withPhone.length;

    // The core rule: skip any row whose NORMALIZED phone already exists in the
    // contacts table (one bulk in-memory Set lookup — no per-row SELECT), so an
    // existing contact is never re-imported or overwritten. Only the rest insert.
    const toInsert = withPhone.filter((r) => !existingNormalizedPhones.has(r.phoneKey));
    const existingDuplicates = withPhone.length - toInsert.length;

    const summarize = (added) => ({
      total_rows: totalRows,
      added,
      duplicates: withinFileDuplicates + existingDuplicates + (toInsert.length - added),
      duplicates_in_file: withinFileDuplicates,
      duplicates_existing: existingDuplicates,
      invalid: invalidNameRows + noPhoneCount,
      invalid_no_phone: noPhoneCount,
      // Back-compat fields still read by older UI builds.
      contacts_inserted: added,
      contacts_updated: 0,
      contacts_skipped_no_phone: noPhoneCount,
      row_errors: rowErrors,
      summary,
      unmatched_districts: unmatchedDistricts,
      unmatched_assemblies: unmatchedAssemblies,
    });

    if (dryRun) {
      return NextResponse.json({ ...summarize(toInsert.length), dry_run: true });
    }

    // Nothing new to write — return the counts without opening a transaction.
    if (toInsert.length === 0) {
      return NextResponse.json(summarize(0));
    }

    let added = 0;
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();

      const designationIds = await resolveDesignationIds(conn, toInsert.map((r) => r.position));

      for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
        const chunk = toInsert.slice(i, i + INSERT_CHUNK);
        const placeholders = chunk.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(",");
        const vals = [];
        for (const r of chunk) {
          vals.push(
            r.name, r.phone, r.address, r.zoneId, r.lokSabhaId, r.districtId, r.assemblyId, r.wardId, r.boothId,
            designationIds.get(String(r.position || "").trim()) || null
          );
        }
        // INSERT IGNORE (NOT ON DUPLICATE KEY UPDATE): only new rows are written;
        // an existing contact is never modified. `affectedRows` is the number
        // actually inserted, so the "added" count reflects real DB writes.
        const [res] = await conn.query(
          `INSERT IGNORE INTO contacts (person_name, phone_number, address, zone_id, lok_sabha_id, district_id, assembly_id, ward_id, booth_id, designation_id)
           VALUES ${placeholders}`,
          vals
        );
        added += res.affectedRows || 0;
      }

      await conn.commit();
      return NextResponse.json(summarize(added));
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("contacts import-excel error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
