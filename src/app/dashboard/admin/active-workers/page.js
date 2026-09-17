"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Users, Search, Loader2, ChevronDown, ChevronRight, Phone, RefreshCcw } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import Avatar from "@/components/Avatar";
import { isAdmin } from "@/lib/permissions";
import { usePageGuard } from "@/components/usePageGuard";
import { ACTIVE_STATUS_OPTIONS, ACTIVE_STATUS_LABEL } from "@/lib/activeStatus";

// Badge colours for the four canonical Active Status values (Very Active / Active
// stand out clearly). Unset → a plain "Not set" chip.
const STATUS_STYLE = {
  VERY_ACTIVE: "bg-emerald-100 text-emerald-700",
  ACTIVE: "bg-blue-100 text-blue-700",
  AVERAGE: "bg-amber-100 text-amber-700",
  NOT_ACTIVE: "bg-gray-100 text-gray-500",
};

// Contacts → Active Workers. "Active worker" = a contact assigned to a caller and
// still reachable (not a wrong number); grouped user-wise by that caller. Counts
// come from a backend aggregate (whole authorized dataset, not a page); each
// caller expands to their contacts via the existing /api/contacts endpoint, so
// role/territory scope and permissions are exactly the Contacts module's.
export default function ActiveWorkersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { ready, allowed } = usePageGuard("contacts", isAdmin(session));

  const [groups, setGroups] = useState([]);
  const [total, setTotal] = useState(0);
  const [callers, setCallers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(""); // "" = all, else a canonical value
  const [expanded, setExpanded] = useState(null); // user_id currently expanded

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (search) p.set("search", search);
      const r = await fetch(`/api/contacts/active-workers?${p}`);
      if (r.ok) {
        const d = await r.json();
        setGroups(d.groups || []);
        setTotal(d.total || 0);
        setCallers(d.callers || 0);
      }
    } finally { setLoading(false); }
  }, [search]);

  useEffect(() => {
    if (!allowed) return;
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [allowed, search, load]);

  // Persist a worker's Active Status to the backend (users.active_status) and
  // reflect it locally — the value survives refresh/relogin because it is stored,
  // never kept only in React state.
  const saveStatus = useCallback(async (userId, value) => {
    // Optimistic; revert on failure.
    setGroups((gs) => gs.map((g) => (g.user_id === userId ? { ...g, active_status: value, _saving: true } : g)));
    try {
      const r = await fetch("/api/contacts/active-workers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, active_status: value }),
      });
      const d = await r.json().catch(() => ({}));
      setGroups((gs) => gs.map((g) => (g.user_id === userId
        ? { ...g, active_status: r.ok ? (d.active_status || value) : g.active_status, _saving: false }
        : g)));
    } catch {
      setGroups((gs) => gs.map((g) => (g.user_id === userId ? { ...g, _saving: false } : g)));
    }
  }, []);

  const visibleGroups = statusFilter ? groups.filter((g) => g.active_status === statusFilter) : groups;

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={Users}
        title="Active Workers"
        description="Assigned, still-reachable contacts grouped by the caller who owns them."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Contacts", href: "/dashboard/admin/contacts" }, { label: "Active Workers" }]}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <SumCard label="Active Workers" value={Number(total).toLocaleString("en-IN")} accent />
        <SumCard label="Callers" value={Number(callers).toLocaleString("en-IN")} />
        <SumCard label="Avg per Caller" value={callers ? Math.round(total / callers).toLocaleString("en-IN") : "—"} />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search caller…"
                 className="w-full pl-9 h-10 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="h-10 px-3 rounded-lg border border-gray-200 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-[#164FA3]">
          <option value="">All statuses</option>
          {ACTIVE_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button onClick={() => { setSearch(""); setStatusFilter(""); }} className="h-10 px-4 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2">
          <RefreshCcw size={14} /> Reset
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-gray-400"><Loader2 className="inline animate-spin text-[#164FA3]" /></div>
        ) : visibleGroups.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            {statusFilter ? `No workers with status “${ACTIVE_STATUS_LABEL[statusFilter]}”.` : "No active workers found for your access."}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visibleGroups.map((g) => (
              <li key={g.user_id}>
                <div className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50">
                  <button
                    onClick={() => setExpanded(expanded === g.user_id ? null : g.user_id)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    {expanded === g.user_id ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
                    <Avatar name={g.username} size={30} className="bg-[#164FA3]/10 border border-gray-200 shrink-0" textClassName="text-[#164FA3] text-[11px]" />
                    <span className="font-semibold text-gray-900 truncate">{g.username}</span>
                  </button>
                  <div className="flex items-center gap-2 text-xs shrink-0">
                    {/* Active Status — VIEW + ADD/UPDATE here (the authoritative place). */}
                    <StatusControl group={g} onChange={(v) => saveStatus(g.user_id, v)} />
                    <span className="text-gray-400 hidden md:inline">{g.pending_count} pending · {g.done_count} done</span>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#164FA3] text-white font-bold">{Number(g.active_count).toLocaleString("en-IN")}</span>
                  </div>
                </div>
                {expanded === g.user_id && <CallerContacts userId={g.user_id} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// The contacts assigned to one caller — loaded from the existing endpoint, which
// already applies the same scope/permission checks and excludes wrong numbers.
function CallerContacts({ userId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/contacts?assigned_to=${encodeURIComponent(userId)}&page_size=200`)
      .then((r) => r.ok ? r.json() : { contacts: [] })
      .then((d) => { if (alive) setRows(d.contacts || []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [userId]);

  if (rows === null) return <div className="px-6 py-4 text-sm text-gray-400"><Loader2 className="inline animate-spin text-[#164FA3]" size={14} /> Loading…</div>;
  if (rows.length === 0) return <div className="px-6 py-4 text-sm text-gray-400">No contacts.</div>;
  return (
    <div className="bg-gray-50/60 px-4 pb-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr><th className="px-3 py-2 font-semibold">Name</th><th className="px-3 py-2 font-semibold">Phone</th><th className="px-3 py-2 font-semibold">Designation</th><th className="px-3 py-2 font-semibold">Location</th><th className="px-3 py-2 font-semibold">Status</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    <Avatar name={c.person_name} src={c.photo_url} size={24} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3] text-[10px]" />
                    <span className="font-medium text-gray-900">{c.person_name}</span>
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-600 whitespace-nowrap"><Phone size={11} className="inline mr-1 text-gray-400" />{c.phone_number}</td>
                <td className="px-3 py-2 text-gray-700">{c.designation_name || "—"}</td>
                <td className="px-3 py-2 text-gray-500 text-xs">{[c.district_name, c.assembly_name].filter(Boolean).join(" / ") || "—"}</td>
                <td className="px-3 py-2">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${c.is_completed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{c.is_completed ? "Done" : "Pending"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// One worker's Active Status: a colour-coded badge (Very Active / Active stand
// out) plus the picker to add/update it. The change is saved to the backend, so
// it persists across refresh/relogin and is the same value the Log Outcome reads.
function StatusControl({ group, onChange }) {
  const val = group.active_status || "";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`px-2 py-0.5 rounded-full font-semibold ${val ? STATUS_STYLE[val] : "bg-gray-100 text-gray-400"}`}>
        {val ? ACTIVE_STATUS_LABEL[val] : "Not set"}
      </span>
      <select
        value={val}
        onChange={(e) => onChange(e.target.value)}
        disabled={group._saving}
        aria-label={`Set active status for ${group.username}`}
        className="h-7 rounded-md border border-gray-200 bg-white text-[11px] font-semibold text-gray-600 px-1.5 outline-none focus:ring-2 focus:ring-[#164FA3] disabled:opacity-60"
      >
        <option value="" disabled>Set…</option>
        {ACTIVE_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

function SumCard({ label, value, accent }) {
  return (
    <div className={`${accent ? "bg-[#164FA3] text-white" : "bg-white border border-gray-100"} rounded-xl p-4 shadow-sm`}>
      <div className={`text-2xl font-bold ${accent ? "" : "text-gray-900"}`}>{value}</div>
      <div className={`text-xs font-medium mt-1 ${accent ? "text-blue-200" : "text-gray-500"}`}>{label}</div>
    </div>
  );
}
