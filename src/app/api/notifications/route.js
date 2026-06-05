import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isOversight, scopeFilterSync } from "@/lib/permissions";
import { query } from "@/lib/db";

// Returns live, rule-derived alerts (computed on the fly) for oversight roles.
// This keeps the notification center always current without a cron.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    if (!isOversight(session)) return NextResponse.json({ alerts: [], count: 0 });

    // Scope every alert query to the admin's territory, declaring each table's
    // available geo columns so the helper resolves through the hierarchy.
    const wScope = scopeFilterSync(session.user, "w");                            // workers: all three
    const tScope = scopeFilterSync(session.user, "t", { cols: ["district_id"] }); // tasks: district only
    const cScope = scopeFilterSync(session.user, "ct");                           // contacts: all three
    const cmScope = scopeFilterSync(session.user, "cm", { cols: ["district_id", "assembly_id"] }); // complaints

    const alerts = [];

    // Inactive workers
    const [[inactive]] = await query(
      `SELECT COUNT(*) AS n FROM workers w WHERE status='inactive' ${wScope.where}`,
      wScope.params
    ).then((r) => [r]);
    if (inactive.n > 0) alerts.push({ type: "inactive_worker", severity: "warning", title: `${inactive.n} inactive workers`, body: "Workers marked inactive need follow-up.", link: "/dashboard/admin/workers" });

    // Weak districts (low avg activity) — scope the worker join the same way.
    // For simplicity reuse the wScope as the district filter on workers.
    const weak = await query(
      `SELECT ld.name, COALESCE(ROUND(AVG(w.activity_score)),0) AS avg
         FROM locations ld LEFT JOIN workers w ON w.district_id = ld.id ${wScope.where ? `AND ${wScope.where.replace(/^AND /, "")}` : ""}
        WHERE ld.type='district'
        GROUP BY ld.id, ld.name
        HAVING COUNT(w.id) > 0 AND avg < 40
        ORDER BY avg ASC LIMIT 5`,
      wScope.params
    );
    weak.forEach((d) => alerts.push({ type: "weak_booth", severity: "warning", title: `Weak area: ${d.name}`, body: `Avg activity ${d.avg}. Needs attention.`, link: "/dashboard/strength" }));

    // Pending/overdue tasks
    const [[tasks]] = await query(
      `SELECT COUNT(*) AS n FROM tasks t WHERE status IN ('pending','in_progress') AND deadline < CURDATE() ${tScope.where}`,
      tScope.params
    ).then((r) => [r]);
    if (tasks.n > 0) alerts.push({ type: "pending_task", severity: "critical", title: `${tasks.n} overdue tasks`, body: "Tasks past their deadline.", link: "/dashboard/tasks" });

    // Overdue follow-ups (on contacts)
    const [[fu]] = await query(
      `SELECT COUNT(*) AS n FROM contacts ct WHERE is_completed=0 AND follow_up_date IS NOT NULL AND follow_up_date < CURDATE() ${cScope.where}`,
      cScope.params
    ).then((r) => [r]);
    if (fu.n > 0) alerts.push({ type: "follow_up", severity: "warning", title: `${fu.n} overdue follow-ups`, body: "Scheduled callbacks are past due.", link: "/dashboard/supervisor/follow-ups" });

    // Open complaints
    const [[comp]] = await query(
      `SELECT COUNT(*) AS n FROM complaints cm WHERE status='open' ${cmScope.where}`,
      cmScope.params
    ).then((r) => [r]);
    if (comp.n > 0) alerts.push({ type: "complaint", severity: "info", title: `${comp.n} open complaints`, body: "Citizen complaints awaiting action.", link: "/dashboard/admin/complaints" });

    return NextResponse.json({ alerts, count: alerts.length });
  } catch (err) {
    console.error("notifications error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
