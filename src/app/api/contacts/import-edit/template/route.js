import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { pageAllowed } from "@/lib/pageAccess";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

// GET — a starter workbook for Import Edit: the column headings plus a Help sheet.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!(await pageAllowed(session, "contacts", session && isOversight(session)))) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const wb = XLSX.utils.book_new();
  const head = ["Contact ID", "Name", "Phone", "Address", "Pincode", "Village", "Remarks", "Designation", "District", "Assembly"];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, [123, "", "", "", "", "", "", "", "", ""]]), "Contacts");
  const help = [
    ["Import Edit — how it works"],
    ["Contact ID", "Required. Identifies the EXISTING contact to update (preferred). Without a Contact ID column, use a Phone column instead (a number shared by several contacts is skipped)."],
    ["Phone", "With a Contact ID column this is the NEW phone number. Without one it identifies the contact; add a 'New Phone' column to change it."],
    ["Blank cell", "Leaves that field unchanged. A blank never erases existing data."],
    ["[clear]", "Type [clear] in Address, Pincode, Village or Remarks to deliberately empty that field."],
    ["Designation", "Existing designation names, separated by commas. The contact's designations become exactly this list."],
    ["District / Assembly", "Names as in the Location master. An assembly must belong to the district."],
    ["Only include", "Delete the columns you do not want to change; only columns that are present are updated."],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(help), "Help");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="contacts-import-edit-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
