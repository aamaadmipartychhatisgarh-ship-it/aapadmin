import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import { query } from "@/lib/db";
import * as XLSX from "xlsx";
import { CONTACT_FIELDS } from "@/lib/contactFieldConfig";
import { listWings } from "@/lib/wingDesignations";
import { QUALIFICATIONS, EDUCATION_LEVELS } from "@/lib/qualificationOptions";
import { VEHICLES } from "@/lib/vehicleOptions";

export const dynamic = "force-dynamic";

// GET — the Import / Import Edit template: EVERY field of the Contact Edit form as a column (headings come from the
// one field registry, lib/contactFieldConfig - the same headings the Excel export uses, so an exported sheet can be
// edited and imported back), a sample row, an Instructions sheet and a Reference sheet of valid values.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!(await pageAllowed(session, "contacts", session && isOversight(session)))) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const wb = XLSX.utils.book_new();
  const head = CONTACT_FIELDS.map((f) => f.label);
  const ws = XLSX.utils.aoa_to_sheet([head, CONTACT_FIELDS.map((f) => (f.key === "id" ? "" : f.sample ?? ""))]);
  ws["!cols"] = head.map((h) => ({ wch: Math.max(14, h.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, "Contacts");
  const help = [
    ["Import / Import Edit — how it works"],
    ["Matching", "Import Edit updates EXISTING contacts only (never creates one): by Contact ID when that column is present, otherwise by Mobile Number (last 10 digits; a number shared by several contacts is skipped). Import Excel adds NEW contacts and skips numbers that already exist."],
    ["Blank cell", "Leaves that field exactly as it is. A blank never erases a photo, address, designation, Wing, Zone, District, Assembly, Block, Lok Sabha or anything else."],
    ["[clear]", "Type [clear] in Address, Village/City, Pincode, Remarks/Notes, Qualification or Vehicle to deliberately empty that field (the preview asks you to confirm)."],
    ["Only include", "Delete the columns you do not want to change; only the columns present in the file are read."],
    ["", ""],
    ["Column", "Rule"],
    ...CONTACT_FIELDS.map((f) => [f.label, f.note]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(help), "Instructions");
  const [wings, zones, districts] = await Promise.all([
    listWings().catch(() => []),
    query("SELECT name FROM locations WHERE type = 'zone' ORDER BY name").catch(() => []),
    query("SELECT name FROM locations WHERE type = 'district' ORDER BY name").catch(() => []),
  ]);
  const cols = [
    ["Wing", ...wings.filter((w) => w.enabled == null || Number(w.enabled) === 1).map((w) => w.name)],
    ["Zone", ...zones.map((z) => z.name)],
    ["District", ...districts.map((d) => d.name)],
    ["Qualification", ...QUALIFICATIONS.map((q) => q.label)],
    ["Education Level", ...EDUCATION_LEVELS.map((e) => e.label)],
    ["Vehicle", ...VEHICLES.map((v) => v.label)],
    ["Status", "Pending", "Done"],
  ];
  const n = Math.max(...cols.map((c) => c.length));
  const ref = Array.from({ length: n }, (_, r) => cols.map((c) => c[r] ?? ""));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ref), "Reference");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="contacts-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
