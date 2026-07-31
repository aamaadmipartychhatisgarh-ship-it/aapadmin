"use client";

import { useEffect, useState } from "react";
import { Activity, PhoneCall, CheckCircle2 } from "lucide-react";

// Live worker/contact stats, sourced from the same Universal Reports Engine
// summary call the Dashboard Overview's ReportsSummaryRow already uses
// (POST /api/reports with {module, time:"all", group_by}) — reuses the
// existing endpoint and response shape ({totalRecords, rows:[{group_key,count}]})
// instead of introducing new backend aggregation code.
const CARDS = [
  { key: "workers", label: "Worker Status", groupBy: "status", icon: Activity, color: "bg-blue-50 text-[#164FA3]" },
  { key: "contactsAssigned", module: "contacts", label: "Contact Assignment", groupBy: "assigned_to", icon: PhoneCall, color: "bg-violet-50 text-violet-600" },
  { key: "contactsDone", module: "contacts", label: "Call Completion", groupBy: "is_completed", icon: CheckCircle2, color: "bg-emerald-50 text-emerald-600" },
];

export default function WorkerActivityPanel() {
  const [data, setData] = useState(null);

  useEffect(() => {
    const run = (module, group_by) =>
      fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module, time: "all", group_by }) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    Promise.all([run("workers", "status"), run("contacts", "assigned_to"), run("contacts", "is_completed")])
      .then(([workers, contactsAssigned, contactsDone]) => setData({ workers, contactsAssigned, contactsDone }));
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {CARDS.map((c) => {
        const r = data?.[c.key];
        const Icon = c.icon;
        const rows = (r?.rows || []).slice(0, 4);
        const module = c.module || c.key;
        return (
          <a
            key={c.key}
            href={`/dashboard/reports?module=${module}`}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-2 mb-2.5">
              <div className={`w-7 h-7 rounded-lg ${c.color} flex items-center justify-center shrink-0`}><Icon size={15} /></div>
              <span className="font-semibold text-gray-800 text-sm flex-1 truncate">{c.label}</span>
              <span className="text-xs text-gray-400 font-medium">{data ? (r?.totalRecords?.toLocaleString("en-IN") ?? "—") : "…"}</span>
            </div>
            {!data ? (
              <p className="text-xs text-gray-400">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-xs text-gray-400">No data.</p>
            ) : (
              <div className="space-y-1">
                {rows.map((row, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 truncate">{c.key === "contactsDone" ? (row.group_key === "1" || row.group_key === 1 ? "Completed" : "Pending") : (row.group_key ?? "Pool (unassigned)")}</span>
                    <span className="font-semibold text-gray-700">{Number(row.count).toLocaleString("en-IN")}</span>
                  </div>
                ))}
              </div>
            )}
          </a>
        );
      })}
    </div>
  );
}
