import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { restoreNotInServiceContacts } from "@/lib/wrongNumberRestore";

// POST /api/admin/wrong-numbers/restore-not-in-service { ids: [..], dry_run? }
// Restore Not-in-Service contacts from the Wrong Number section to the Contact List (same oversight gate as the existing
// Restore action: Supervisor / Admin). dry_run classifies the selection for the confirmation dialog.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body.ids) || body.ids.some((x) => !Number.isInteger(Number(x)) || Number(x) <= 0)) {
      return NextResponse.json({ message: "Invalid selection." }, { status: 400 });
    }
    const dry = body.dry_run === true;
    const r = await restoreNotInServiceContacts({ ids: body.ids, userId: Number(session.user.id) || null, dryRun: dry });
    if (r.status === 200 && !dry && r.restored > 0) {
      await logAudit(session, { action: "contact.wrong_number_restore", entityType: "contact", entityId: null, details: { restored: r.restored, not_in_service: true, ids: (r.restored_ids || []).slice(0, 500) } }).catch(() => {});
    }
    const { status, ...rest } = r;
    return NextResponse.json(rest, { status });
  } catch (err) {
    console.error("wrong-numbers restore-not-in-service error:", err);
    return NextResponse.json({ message: "Could not restore the selected contacts. Nothing was changed." }, { status: 500 });
  }
}
