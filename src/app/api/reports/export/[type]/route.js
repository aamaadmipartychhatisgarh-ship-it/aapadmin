import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight } from "@/lib/permissions";
import { query } from "@/lib/db";
import * as XLSX from "xlsx";

async function reportData(type, searchParams) {
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const districtId = searchParams.get("district_id");

  if (type === "workers") {
    const rows = await query(
      `SELECT w.name AS Name, w.mobile AS Mobile, w.position AS Position,
              ld.name AS District, la.name AS Assembly, w.activity_score AS Activity, w.status AS Status
         FROM workers w
         LEFT JOIN locations ld ON ld.id = w.district_id
         LEFT JOIN locations la ON la.id = w.assembly_id
         ${districtId ? "WHERE w.district_id = ?" : ""}
         ORDER BY w.activity_score DESC`,
      districtId ? [districtId] : []
    );
    return { rows, sheet: "Workers" };
  }

  if (type === "calls") {
    const where = [], params = [];
    if (dateFrom) { where.push("DATE(c.called_at) >= ?"); params.push(dateFrom); }
    if (dateTo) { where.push("DATE(c.called_at) <= ?"); params.push(dateTo); }
    if (districtId) { where.push("c.district_id = ?"); params.push(districtId); }
    const rows = await query(
      `SELECT c.called_at AS When_, c.person_name AS Person, c.phone_number AS Phone,
              u.username AS Agent, cs.name AS Status, ld.name AS District,
              c.duration_seconds AS Duration_s, c.sentiment AS Sentiment, c.remarks AS Remarks
         FROM calls c
         LEFT JOIN users u ON u.id = c.user_id
         LEFT JOIN call_statuses cs ON cs.id = c.status_id
         LEFT JOIN locations ld ON ld.id = c.district_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY c.called_at DESC LIMIT 5000`,
      params
    );
    return { rows, sheet: "Calls" };
  }

  if (type === "areas") {
    const rows = await query(
      `SELECT ld.name AS District,
              (SELECT COUNT(*) FROM workers w WHERE w.district_id=ld.id) AS Workers,
              (SELECT COALESCE(ROUND(AVG(w.activity_score)),0) FROM workers w WHERE w.district_id=ld.id) AS Avg_Activity,
              (SELECT COUNT(*) FROM teams t WHERE t.location_id=ld.id) AS Teams,
              (SELECT COUNT(*) FROM calls c WHERE c.district_id=ld.id) AS Calls,
              (SELECT COUNT(*) FROM complaints cp WHERE cp.district_id=ld.id) AS Complaints
         FROM locations ld WHERE ld.type='district' ORDER BY ld.name`
    );
    return { rows, sheet: "Area Report" };
  }

  if (type === "organization") {
    const [[w]] = await query(`SELECT COUNT(*) AS total, SUM(status='active') AS active FROM workers`).then((r) => [r]);
    const [[t]] = await query(`SELECT COUNT(*) AS total FROM teams`).then((r) => [r]);
    const [[c]] = await query(`SELECT COUNT(*) AS total FROM calls`).then((r) => [r]);
    const [[tk]] = await query(`SELECT COUNT(*) AS total, SUM(status='completed') AS done FROM tasks`).then((r) => [r]);
    const [[cp]] = await query(`SELECT COUNT(*) AS total, SUM(status='resolved') AS resolved FROM complaints`).then((r) => [r]);
    const rows = [
      { Metric: "Total Workers", Value: w.total }, { Metric: "Active Workers", Value: w.active || 0 },
      { Metric: "Total Teams", Value: t.total }, { Metric: "Total Calls", Value: c.total },
      { Metric: "Tasks", Value: tk.total }, { Metric: "Tasks Completed", Value: tk.done || 0 },
      { Metric: "Complaints", Value: cp.total }, { Metric: "Complaints Resolved", Value: cp.resolved || 0 },
    ];
    return { rows, sheet: "Organization" };
  }
  return null;
}

export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isOversight(session)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { type } = await params;
    const { searchParams } = new URL(req.url);
    const data = await reportData(type, searchParams);
    if (!data) return NextResponse.json({ message: "Unknown report" }, { status: 404 });

    const ws = XLSX.utils.json_to_sheet(data.rows.length ? data.rows : [{ Note: "No data for the selected filters" }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, data.sheet);
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${type}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (err) {
    console.error("reports export error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
