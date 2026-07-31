import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { canManageWorkers } from "@/lib/permissions";
import { query } from "@/lib/db";

// Call history summary for a worker — total calls, status breakdown (Picked /
// Not Picked / Busy / etc.), total talk time, last call — sourced from the
// `calls` table via the worker's linked contact (contacts.worker_id), the
// same link src/lib/workerSync.js maintains. Falls back to matching on the
// last 10 digits of the phone number for records from before that link
// column existed, mirroring the fallback workerSync.js itself uses.
export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !canManageWorkers(session)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;

    const [worker] = await query("SELECT id, mobile FROM workers WHERE id = ?", [id]);
    if (!worker) return NextResponse.json({ message: "Worker not found" }, { status: 404 });

    let hasWorkerLink = true;
    try { await query("SELECT worker_id FROM contacts LIMIT 1"); } catch { hasWorkerLink = false; }

    const last10 = worker.mobile ? String(worker.mobile).replace(/\D/g, "").slice(-10) : null;
    const contactWhere = hasWorkerLink
      ? "(c.worker_id = ? OR (c.worker_id IS NULL AND ? IS NOT NULL AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone_number,' ',''),'-',''),'+',''),'(',''),')',''),'.',''),10) = ?))"
      : "(? IS NOT NULL AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.phone_number,' ',''),'-',''),'+',''),'(',''),')',''),'.',''),10) = ?)";
    const contactParams = hasWorkerLink ? [id, last10, last10] : [last10, last10];

    let hasDuration = true;
    try { await query("SELECT duration_seconds FROM calls LIMIT 1"); } catch { hasDuration = false; }

    const rows = await query(
      `SELECT cs.name AS status, COUNT(*) AS n${hasDuration ? ", COALESCE(SUM(cl.duration_seconds), 0) AS talk_seconds" : ""}
         FROM calls cl
         JOIN contacts c ON c.id = cl.contact_id
         LEFT JOIN call_statuses cs ON cs.id = cl.status_id
        WHERE ${contactWhere}
        GROUP BY cs.name`,
      contactParams
    );

    const [[last]] = await query(
      `SELECT cl.called_at, cs.name AS status
         FROM calls cl
         JOIN contacts c ON c.id = cl.contact_id
         LEFT JOIN call_statuses cs ON cs.id = cl.status_id
        WHERE ${contactWhere}
        ORDER BY cl.called_at DESC LIMIT 1`,
      contactParams
    ).then((r) => [r]);

    const byStatus = {};
    let total = 0, talkSeconds = 0;
    for (const r of rows) {
      const name = r.status || "Unknown";
      byStatus[name] = Number(r.n);
      total += Number(r.n);
      if (hasDuration) talkSeconds += Number(r.talk_seconds || 0);
    }

    return NextResponse.json({
      total,
      by_status: byStatus,
      talk_seconds: talkSeconds,
      last_call_at: last?.called_at || null,
      last_call_status: last?.status || null,
    });
  } catch (err) {
    console.error("worker call-history error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
