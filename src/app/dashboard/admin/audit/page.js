"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { isAdmin } from "@/lib/permissions";
import { Loader2, Shield, Search, ChevronLeft, ChevronRight } from "lucide-react";
import PageHeader from "@/components/PageHeader";

// Human labels for audit actions (kebab slugs -> readable).
const ACTION_LABEL = {
  "contacts.distribute": "Contacts distributed",
  "contacts.unassign": "Contacts recalled",
  "contacts.delete_wrong_numbers": "Wrong numbers deleted",
  "contact.delete": "Contact deleted",
  "worker.delete": "Worker deleted",
  "user.create": "User created",
  "user.delete": "User deleted",
};
const label = (a) => ACTION_LABEL[a] || a;

function fmt(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).format(d);
  return `${date} • ${time}`;
}

export default function AuditPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isAdmin(session)) router.push("/dashboard");
  }, [status, session, router]);
  if (status !== "authenticated" || !isAdmin(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body />;
}

function Body() {
  const [data, setData] = useState({ logs: [], total: 0, page: 1, pages: 1, actions: [] });
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      const p = new URLSearchParams({ page: String(page), limit: "50" });
      if (action) p.set("action", action);
      if (actor) p.set("actor", actor);
      fetch(`/api/audit?${p}`).then((r) => r.json()).then((d) => setData(d)).finally(() => setLoading(false));
    }, actor ? 300 : 0);
    return () => clearTimeout(t);
  }, [action, actor, page]);

  const start = (data.page - 1) * 50;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={Shield}
        title="Audit Logs"
        description="Who did what — assignments, deletions and account changes."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Administration" }, { label: "Audit Logs" }]}
      />

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={actor} onChange={(e) => { setActor(e.target.value); setPage(1); }} placeholder="Search by actor" className="w-full pl-9 pr-3 h-9 rounded-lg border border-gray-200 text-sm outline-none" />
        </div>
        <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All actions</option>
          {(data.actions || []).map((a) => <option key={a} value={a}>{label(a)}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>
        ) : data.logs.length === 0 ? (
          <div className="p-12 text-center text-gray-400"><Shield size={36} className="mx-auto text-gray-300 mb-3" />No audit entries.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold text-gray-600 w-12">S.No.</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">When</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Actor</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Action</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((l, i) => (
                  <tr key={l.id} className="border-t border-gray-100 hover:bg-gray-50 align-top">
                    <td className="px-4 py-3 text-gray-500 tabular-nums">{start + i + 1}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{fmt(l.created_at)}</td>
                    <td className="px-4 py-3 text-gray-800 font-medium">{l.actor_username || l.actor_name || "System"}</td>
                    <td className="px-4 py-3"><span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-blue-50 text-[#164FA3]">{label(l.action)}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[420px] break-words">
                      {l.entity_type ? <span className="text-gray-400">{l.entity_type}{l.entity_id ? ` #${l.entity_id}` : ""} · </span> : null}
                      {l.details ? <span className="font-mono">{typeof l.details === "string" ? l.details : JSON.stringify(l.details)}</span> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data.pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Page {data.page} of {data.pages} · {data.total} entries</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40"><ChevronLeft size={16} /></button>
            <button disabled={page >= data.pages} onClick={() => setPage(page + 1)} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
