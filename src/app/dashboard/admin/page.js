"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Gauge, TrendingUp, TrendingDown, Minus, FileText, ChevronRight, ClipboardList, MessageSquareWarning, Users } from "lucide-react";
import { isAdmin, normalizeRole, ROLES } from "@/lib/permissions";
import SummaryDashboard from "@/components/SummaryDashboard";
import AnalyticsPanel from "@/components/AnalyticsPanel";

// State/Zone/District/Assembly Overview — now a single tabbed page: the daily
// calling KPIs (Overview), the full chart suite (Analytics, merged in from the
// old standalone page), and — for top-tier admins — the Supervisor Overview,
// all sharing one compact header instead of three separate pages/headings.
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "analytics", label: "Analytics" },
];

// Which report pages a role can actually reach — mirrors ADMIN_MENUS in
// dashboard/layout.js, used only to decide what the quick-jump dropdown offers.
// Quick-jump options shown next to the dashboard's Full Ranking link. The
// "Reports Center" and "Caller Report" options were removed here per request;
// both pages still exist and stay reachable from the sidebar / their own routes
// — only these Full-Ranking dropdown entries are gone.
const REPORT_LINKS_BY_TIER = {
  top: [ // super_admin, state_admin, zone_admin
    { href: "/dashboard/rankings", label: "Rankings" },
    { href: "/dashboard/strength", label: "Strength" },
  ],
  district: [
    { href: "/dashboard/rankings", label: "Rankings" },
  ],
  none: [],
};

export default function AdminDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [scope, setScope] = useState(null);
  const [tab, setTab] = useState("overview");
  const [strength, setStrength] = useState(null);
  const [reportsSummary, setReportsSummary] = useState(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isAdmin(session)) router.push("/dashboard");
  }, [status, session, router]);

  // Territory label for the heading (State / Zone / District / Assembly Overview).
  useEffect(() => {
    if (status !== "authenticated" || !isAdmin(session)) return;
    fetch("/api/me/scope").then((r) => r.json()).then(setScope).catch(() => {});
  }, [status, session]);

  // Organizational strength — how strong we are geographically (state → zone →
  // district → assembly), surfaced first because that's the actual mission,
  // not the calling metrics (which stay one tab away, not the front page).
  useEffect(() => {
    if (status !== "authenticated" || !isAdmin(session)) return;
    fetch("/api/strength").then((r) => r.json()).then(setStrength).catch(() => {});
  }, [status, session]);

  // Reports summary — a snapshot of Tasks/Complaints/Workers straight from the
  // Universal Reports Engine, so the dashboard reflects every module without
  // requiring a trip to the Reports Center for the at-a-glance numbers.
  useEffect(() => {
    if (status !== "authenticated" || !isAdmin(session)) return;
    const run = (module, group_by) =>
      fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module, time: "all", group_by }) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    Promise.all([run("tasks", "status"), run("complaints", "status"), run("workers", "membership_status")])
      .then(([tasks, complaints, workers]) => setReportsSummary({ tasks, complaints, workers }));
  }, [status, session]);

  if (status !== "authenticated" || !isAdmin(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  const canonical = normalizeRole(session.user.role);
  const reportLinks = [ROLES.SUPER_ADMIN, ROLES.STATE_ADMIN, ROLES.ZONE_ADMIN].includes(canonical)
    ? REPORT_LINKS_BY_TIER.top
    : canonical === ROLES.DISTRICT_ADMIN
    ? REPORT_LINKS_BY_TIER.district
    : REPORT_LINKS_BY_TIER.none;

  const titleByLevel = {
    state: "State Overview",
    zone: `Zone Overview · ${scope?.name || ""}`,
    district: `District Overview · ${scope?.name || ""}`,
    assembly: `Assembly Overview · ${scope?.name || ""}`,
  };
  const title = scope ? (titleByLevel[scope.level] || "State Overview") : "State Overview";

  const tabs = TABS;

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Compact header: title + tabs + report quick-jump, one row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 border-b border-gray-200 -mb-px">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3.5 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === t.key ? "border-[#164FA3] text-[#164FA3]" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.key === "overview" ? title : t.label}
            </button>
          ))}
        </div>
        {reportLinks.length > 0 && <ReportJumpDropdown links={reportLinks} router={router} />}
      </div>

      {/* Organizational strength — always visible above the tabs, since this
          (not calling volume) is the primary thing the org tracks. */}
      {strength?.summary && <StrengthStrip summary={strength.summary} />}

      {/* Reports summary — snapshot of Tasks / Complaints / Workers, sourced
          live from the Reports Engine. */}
      {reportsSummary && <ReportsSummaryRow summary={reportsSummary} />}

      {tab === "analytics" ? (
        <AnalyticsPanel />
      ) : (
        // Overview is the default — also the fallback for any stale tab value
        // (e.g. the removed "supervisor" view) so no blank panel can show.
        <SummaryDashboard summaryUrl="/api/admin/state-summary" exportUrl="/api/supervisor/export/summary" title={title} />
      )}
    </div>
  );
}

const BAND = {
  strong: { label: "Strong", text: "text-emerald-700", bg: "bg-emerald-50", icon: TrendingUp },
  medium: { label: "Medium", text: "text-amber-700", bg: "bg-amber-50", icon: Minus },
  weak: { label: "Weak", text: "text-red-700", bg: "bg-red-50", icon: TrendingDown },
};

function StrengthStrip({ summary }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5 text-gray-500 text-xs font-semibold uppercase tracking-wide pl-1">
        <Gauge size={14} className="text-[#164FA3]" /> District Strength
      </div>
      {["strong", "medium", "weak"].map((b) => {
        const meta = BAND[b]; const Icon = meta.icon;
        return (
          <div key={b} className={`${meta.bg} rounded-xl px-3 py-1.5 flex items-center gap-2`}>
            <Icon size={14} className={meta.text} />
            <span className={`font-bold text-sm ${meta.text}`}>{summary[b]}</span>
            <span className={`text-xs font-medium ${meta.text}`}>{meta.label}</span>
          </div>
        );
      })}
      <a href="/dashboard/strength" className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-[#164FA3] hover:underline">
        Full ranking <ChevronRight size={14} />
      </a>
    </div>
  );
}

const SUMMARY_CARDS = [
  { key: "tasks", label: "Tasks", icon: ClipboardList, color: "text-[#164FA3]", bg: "bg-blue-50" },
  { key: "complaints", label: "Complaints", icon: MessageSquareWarning, color: "text-amber-600", bg: "bg-amber-50" },
  { key: "workers", label: "Workers (membership)", icon: Users, color: "text-emerald-600", bg: "bg-emerald-50" },
];

function ReportsSummaryRow({ summary }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {SUMMARY_CARDS.map((c) => {
        const r = summary[c.key];
        const Icon = c.icon;
        const rows = (r?.rows || []).slice(0, 4);
        return (
          <a
            key={c.key}
            href={`/dashboard/reports?module=${c.key}`}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-2 mb-2.5">
              <div className={`w-7 h-7 rounded-lg ${c.bg} ${c.color} flex items-center justify-center shrink-0`}><Icon size={15} /></div>
              <span className="font-semibold text-gray-800 text-sm flex-1 truncate">{c.label}</span>
              <span className="text-xs text-gray-400 font-medium">{r?.totalRecords?.toLocaleString("en-IN") ?? "—"}</span>
            </div>
            {rows.length === 0 ? (
              <p className="text-xs text-gray-400">No data.</p>
            ) : (
              <div className="space-y-1">
                {rows.map((row, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 truncate">{row.group_key ?? "(none)"}</span>
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

function ReportJumpDropdown({ links, router }) {
  return (
    <div className="relative flex items-center gap-2 h-9 pl-3 pr-2 rounded-lg border border-gray-200 bg-white shadow-sm">
      <FileText size={15} className="text-[#164FA3] shrink-0" />
      <select
        defaultValue=""
        onChange={(e) => { if (e.target.value) router.push(e.target.value); }}
        className="text-sm text-gray-700 bg-transparent outline-none font-medium pr-1"
      >
        <option value="" disabled>Jump to a report…</option>
        {links.map((l) => <option key={l.href} value={l.href}>{l.label}</option>)}
      </select>
    </div>
  );
}
