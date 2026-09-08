import { requireSuperAdmin, NO_STORE, parseCommonFilters } from "@/lib/superAdminGuard";
import {
  getWorkersPage, getMembersPage, getRanking, getAssemblyBreakdown, getWardBreakdown,
} from "@/lib/membershipStats";

// CSV export for the current view, respecting the active search + filters +
// period + geo. Super-Admin only. type = workers | members | ranking | assembly | ward.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const MAX_ROWS = 20000;

function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers, rows) {
  const head = headers.map((h) => csvCell(h.label)).join(",");
  const body = rows.map((r) => headers.map((h) => csvCell(h.get(r))).join(",")).join("\n");
  return head + "\n" + body + "\n";
}
function respond(csv, filename) {
  return new Response(csv, {
    headers: {
      ...NO_STORE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// Page through a paginated stats function up to MAX_ROWS.
async function collect(fn, filters, key) {
  const out = []; let page = 1;
  while (out.length < MAX_ROWS) {
    const res = await fn({ ...filters, page, pageSize: 100 });
    const batch = res[key] || [];
    out.push(...batch);
    if (batch.length < 100 || out.length >= res.total) break;
    page += 1;
  }
  return out.slice(0, MAX_ROWS);
}

export async function GET(req) {
  try {
    const { error } = await requireSuperAdmin();
    if (error) return error;
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "workers";
    const f = parseCommonFilters(searchParams);
    const stamp = new Date().toISOString().slice(0, 10);

    if (type === "workers" || type === "ranking") {
      let rows;
      if (type === "ranking") {
        rows = await getRanking({ ...f, limit: 200 });
      } else {
        rows = await collect((o) => getWorkersPage({
          ...o,
          workerStatus: searchParams.get("worker_status") || null,
          membership: searchParams.get("membership") || null,
          sort: searchParams.get("sort") || "members",
          dir: searchParams.get("dir") || "desc",
        }), f, "workers");
      }
      const csv = toCsv([
        { label: "Rank", get: (r) => r.rank },
        { label: "Worker Name", get: (r) => r.name },
        { label: "User ID", get: (r) => r.worker_code },
        { label: "Mobile", get: (r) => r.mobile },
        { label: "Assembly", get: (r) => r.assembly_name },
        { label: "Block/Ward", get: (r) => r.ward_name },
        { label: "Booth", get: (r) => r.booth_name },
        { label: "Members Added", get: (r) => r.member_count },
        { label: "Status", get: (r) => r.worker_status },
        { label: "Last Membership", get: (r) => (r.last_member_at ? String(r.last_member_at).slice(0, 19) : "") },
      ], rows);
      return respond(csv, `${type}-${stamp}.csv`);
    }

    if (type === "members") {
      const rows = await collect((o) => getMembersPage({
        ...o,
        certificate: searchParams.get("certificate") || null,
        whatsapp: searchParams.get("whatsapp") || null,
        sms: searchParams.get("sms") || null,
      }), f, "members");
      const csv = toCsv([
        { label: "Member Name", get: (r) => r.name },
        { label: "Membership ID", get: (r) => r.membership_id },
        { label: "Mobile", get: (r) => r.mobile },
        { label: "Assembly", get: (r) => r.assembly_name },
        { label: "Block/Ward", get: (r) => r.ward_name },
        { label: "Booth", get: (r) => r.booth_name },
        { label: "Added By Worker", get: (r) => r.worker_name },
        { label: "Worker User ID", get: (r) => r.worker_code },
        { label: "Registered", get: (r) => (r.registered_at ? String(r.registered_at).slice(0, 19) : "") },
        { label: "Certificate", get: (r) => r.certificate_status },
        { label: "WhatsApp", get: (r) => r.whatsapp_status },
        { label: "SMS", get: (r) => r.sms_status },
      ], rows);
      return respond(csv, `members-${stamp}.csv`);
    }

    if (type === "assembly" || type === "ward") {
      const rows = type === "assembly" ? await getAssemblyBreakdown(f) : await getWardBreakdown(f);
      const csv = toCsv([
        { label: "Rank", get: (r) => r.rank },
        { label: type === "assembly" ? "Assembly" : "Block/Ward", get: (r) => r.name },
        ...(type === "ward" ? [{ label: "Assembly", get: (r) => r.assembly_name }] : []),
        { label: "Total Workers", get: (r) => r.total_workers },
        { label: "Active Workers", get: (r) => r.active_workers },
        { label: "Total Members", get: (r) => r.total_members },
        { label: "Workers With Members", get: (r) => r.workers_with_members },
        { label: "Workers With 0", get: (r) => r.workers_with_zero },
        { label: "Avg Members/Worker", get: (r) => r.avg_members },
      ], rows);
      return respond(csv, `${type}-report-${stamp}.csv`);
    }

    return new Response("Unknown export type", { status: 400, headers: NO_STORE });
  } catch (err) {
    console.error("[membership] export error:", err);
    return new Response("Export failed", { status: 500, headers: NO_STORE });
  }
}
