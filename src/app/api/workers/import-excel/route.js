import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { getPool } from "@/lib/db";
import * as XLSX from "xlsx";
import { parseAndValidateWorkbook, norm } from "@/lib/workerImport";

// Unified member import from Excel/CSV. Each member is added to BOTH:
//   - workers  (the org member record — always, phone optional)
//   - contacts (the calling pipeline — only if a phone is present + not a dup)
// so imported members show in the Workers list AND in Contact Records and can
// be assigned to callers.
//
// Two modes, same validation logic (src/lib/workerImport.js) so the preview
// and the real import can never disagree:
//   ?dry_run=1  parse + validate only, write nothing, return counts + a
//               sample of row errors for the preview modal.
//   (default)   commit — bulk INSERT new workers/contacts in chunks (so
//               10,000+ row files don't take one round-trip per row and
//               time out), everything in one transaction.
const INSERT_CHUNK = 500;

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
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
    const { validRows, rowErrors, summary, totalRows, unmatchedDistricts, unmatchedAssemblies, workerByMobile, workerByName, existingContactByPhone } = parsed;
    const errorRows = rowErrors.filter((e) => e.severity === "error");
    const warningRows = rowErrors.filter((e) => e.severity === "warning");

    if (dryRun) {
      return NextResponse.json({
        total_rows: totalRows,
        valid_count: validRows.length,
        error_count: errorRows.length,
        warning_count: warningRows.length,
        summary,
        unmatched_districts: unmatchedDistricts,
        unmatched_assemblies: unmatchedAssemblies,
        row_errors: rowErrors,
      });
    }

    // ---------------------------------------------------------- COMMIT ----
    if (validRows.length === 0) {
      return NextResponse.json({
        total_rows: totalRows, workers_inserted: 0, workers_updated: 0,
        contacts_inserted: 0, contacts_updated: 0, contacts_skipped_no_phone: 0,
        row_errors: rowErrors, summary,
        unmatched_districts: unmatchedDistricts, unmatched_assemblies: unmatchedAssemblies,
      });
    }

    const toInsert = [];
    const toUpdate = [];
    for (const r of validRows) {
      const existingId = r.phone ? workerByMobile.get(r.phone) : workerByName.get(norm(r.name));
      if (existingId) toUpdate.push({ ...r, workerId: existingId });
      else toInsert.push(r);
    }

    let workersInserted = 0;
    let workersUpdated = 0;
    let contactsInserted = 0;
    let contactsUpdated = 0;
    const insertedWithIds = [];
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();

      // Bulk INSERT new workers, chunked — one round trip per 500 rows
      // instead of one per row, so a 10,000-row file is ~20 statements.
      // MariaDB assigns contiguous auto-increment ids to a single multi-row
      // INSERT, so insertId..insertId+n-1 map onto the chunk in order —
      // that's how each new worker's id is known for the contacts link
      // below without a second query per row.
      for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
        const chunk = toInsert.slice(i, i + INSERT_CHUNK);
        const placeholders = chunk.map(() => "(?,?,?,?,?,?,?,?,'pending',?,?)").join(",");
        const vals = [];
        for (const r of chunk) vals.push(r.name, r.phone, r.address, r.districtId, r.assemblyId, r.wardId, r.boothId, r.position, r.workerType, r.membershipNo);
        const [result] = await conn.query(
          `INSERT INTO workers (name, mobile, address, district_id, assembly_id, ward_id, booth_id, position, status, worker_type, membership_no)
           VALUES ${placeholders}`,
          vals
        );
        const firstId = result.insertId;
        chunk.forEach((r, idx) => insertedWithIds.push({ ...r, workerId: firstId + idx }));
        workersInserted += chunk.length;
      }

      // Updates to existing workers — one statement per row (typically a
      // much smaller set than fresh-import inserts), inside the same
      // transaction. COALESCE so a file without worker_type/membership_no
      // columns never blanks out what's already saved.
      for (const r of toUpdate) {
        await conn.query(
          `UPDATE workers SET name=?, mobile=?, address=?, district_id=?, assembly_id=?, ward_id=?, booth_id=?, position=?,
                  worker_type=COALESCE(?, worker_type), membership_no=COALESCE(?, membership_no)
            WHERE id=?`,
          [r.name, r.phone, r.address, r.districtId, r.assemblyId, r.wardId, r.boothId, r.position, r.workerType, r.membershipNo, r.workerId]
        );
        workersUpdated++;
      }

      // Auto-assign a stable membership number to anyone who still has none
      // (new inserts with no Membership No column, or pre-existing gaps).
      await conn.query("UPDATE workers SET membership_no = CONCAT('AAPCG', LPAD(id, 6, '0')) WHERE membership_no IS NULL");

      // Contacts — bulk upsert keyed on the UNIQUE phone_number, chunked the
      // same way. ON DUPLICATE KEY UPDATE folds insert+update into one
      // statement per chunk; existingContactByPhone (read before any writes)
      // is only used to report which rows were which, not to decide the SQL.
      const allWritten = [...insertedWithIds, ...toUpdate];
      const withPhone = allWritten.filter((r) => r.phone);
      const contactsSkippedNoPhone = allWritten.length - withPhone.length;
      for (let i = 0; i < withPhone.length; i += INSERT_CHUNK) {
        const chunk = withPhone.slice(i, i + INSERT_CHUNK);
        const placeholders = chunk.map(() => "(?,?,?,?,?,?)").join(",");
        const vals = [];
        for (const r of chunk) vals.push(r.name, r.phone, r.address, r.districtId, r.assemblyId, r.workerId);
        await conn.query(
          `INSERT INTO contacts (person_name, phone_number, address, district_id, assembly_id, worker_id)
           VALUES ${placeholders}
           ON DUPLICATE KEY UPDATE person_name=VALUES(person_name), address=VALUES(address),
             district_id=VALUES(district_id), assembly_id=VALUES(assembly_id), worker_id=VALUES(worker_id)`,
          vals
        );
        for (const r of chunk) {
          if (existingContactByPhone.has(r.phone)) contactsUpdated++; else contactsInserted++;
        }
      }

      await conn.commit();

      return NextResponse.json({
        total_rows: totalRows,
        workers_inserted: workersInserted,
        workers_updated: workersUpdated,
        contacts_inserted: contactsInserted,
        contacts_updated: contactsUpdated,
        contacts_skipped_no_phone: contactsSkippedNoPhone,
        row_errors: rowErrors,
        summary,
        unmatched_districts: unmatchedDistricts,
        unmatched_assemblies: unmatchedAssemblies,
      });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("import-excel error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
