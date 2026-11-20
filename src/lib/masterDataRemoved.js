import { NextResponse } from "next/server";

// Master Data options REMOVED from management (by request): Designation, Designation Rank Order and Call Status.
//
// Only their MANAGEMENT is removed — the add / edit / rename / delete / re-rank / re-order write endpoints answer 410 Gone, so they
// can no longer be used even through a direct URL or an old open page. Nothing is deleted:
//   • the records (designations, their ranks / order, call statuses) and their tables stay exactly as they are;
//   • the READ endpoints (GET /api/designations, GET /api/statuses) stay open — Contacts, Calls, Workspace, Designation
//     Vacancies, reports, filters and forms keep reading them;
//   • the Wing structure, Merge Designations and internal code (lib/…) keep working as before.
export const REMOVED_MASTER_OPTIONS = {
  designation: "Designation",
  designation_rank: "Designation Rank Order",
  call_status: "Call Status",
};

export function removedMasterOption(key) {
  const label = REMOVED_MASTER_OPTIONS[key] || "This option";
  return NextResponse.json(
    { message: `${label} management has been removed from Master Data. Existing records are kept and still used by the app, but they can no longer be added, edited or deleted here.`, removed: true },
    { status: 410, headers: { "Cache-Control": "no-store" } }
  );
}
