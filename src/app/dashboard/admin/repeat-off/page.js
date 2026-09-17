"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { PhoneOff, Search, Loader2, RefreshCcw, Phone, ChevronLeft, ChevronRight } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import Avatar from "@/components/Avatar";
import { isAdmin } from "@/lib/permissions";
import { usePageGuard } from "@/components/usePageGuard";

const TABS = [
  { key: "switched", label: "10+ Times Switched Off" },
  { key: "incoming", label: "10+ Times Incoming Off" },
];

export default function RepeatOffPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { ready, allowed } = usePageGuard("contacts", isAdmin(session));

  // Initial tab from ?type= (client-only read, so no Suspense needed).
  const [tab, setTab] = useState(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("type");
      if (t === "incoming" || t === "switched") return t;
    }
    return "switched";
  });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ type: tab, page: String(page), page_size: "50" });
      if (search) p.set("search", search);
      const r = await fetch(`/api/contacts/repeat-off?${p}`);
      if (r.ok) {
        const d = await r.json();
        setRows(d.contacts || []);
        setTotal(d.total || 0);
        setTotalPages(d.totalPages || 1);
      }
    } finally { setLoading(false); }
  }, [tab, page, search]);

  useEffect(() => { if (allowed) { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); } }, [allowed, load, search]);
  useEffect(() => { setPage(1); }, [tab, search]);

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={PhoneOff}
        title="Repeatedly Off Contacts"
        description="Contacts dispositioned Switched Off or Incoming Off more than 10 times — excluded from the main Contacts list. Nothing is deleted."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Contacts", href: "/dashboard/admin/contacts" }, { label: "10+ Times Off" }]}
      />

      <div className="flex items-center gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3.5 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === t.key ? "border-[#164FA3] text-[#164FA3]" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / phone…"
                 className="w-full pl-9 h-10 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
        </div>
        <button onClick={() => setSearch("")} className="h-10 px-4 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2">
          <RefreshCcw size={14} /> Reset
        </button>
        <span className="ml-auto text-sm text-gray-500"><strong className="text-gray-900">{Number(total).toLocaleString("en-IN")}</strong> contact{total === 1 ? "" : "s"}</span>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Phone</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Designation</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Location</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Caller</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">{tab === "incoming" ? "Incoming Off" : "Switched Off"} count</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" className="py-12 text-center text-gray-400"><Loader2 className="inline animate-spin text-[#164FA3]" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan="6" className="py-12 text-center text-gray-400">No contacts have crossed the 10+ threshold for this status.</td></tr>
              ) : rows.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <Avatar name={c.person_name} src={c.photo_url} size={26} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3] text-[10px]" />
                      <span className="font-medium text-gray-900">{c.person_name}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap"><Phone size={11} className="inline mr-1 text-gray-400" />{c.phone_number}</td>
                  <td className="px-4 py-3 text-gray-700">{c.designation_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{[c.district_name, c.assembly_name].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.assigned_to_username || "—"}</td>
                  <td className="px-4 py-3 text-right"><span className="inline-flex items-center px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 font-bold">{c.off_count}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm bg-gray-50">
            <span className="text-gray-500">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="h-8 px-3 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-white inline-flex items-center gap-1"><ChevronLeft size={14} /> Prev</button>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="h-8 px-3 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-white inline-flex items-center gap-1">Next <ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
