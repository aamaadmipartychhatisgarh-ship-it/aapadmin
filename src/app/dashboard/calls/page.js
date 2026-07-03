"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Phone, Plus, Search, Loader2, Star } from "lucide-react";
import { isOversight } from "@/lib/permissions";

const STATUS_PILL = {
  "Phone Picked":   "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Not Picked":     "bg-amber-50 text-amber-700 border-amber-200",
  "Wrong Number":   "bg-gray-100 text-gray-600 border-gray-200",
  "Rudely Behaved": "bg-red-50 text-red-700 border-red-200",
  "Busy":           "bg-purple-50 text-purple-700 border-purple-200",
  "Switched Off":   "bg-sky-50 text-sky-700 border-sky-200",
};
const SENTIMENT_LABEL = {
  positive: "Positive", supporter: "Supporter", neutral: "Neutral",
  negative: "Negative", opponent: "Opponent",
};

function fmtDur(s) {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function CallsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [calls, setCalls] = useState([]);
  const [search, setSearch] = useState("");
  const [designations, setDesignations] = useState([]);
  const [designationId, setDesignationId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && isOversight(session)) {
      // Admin/supervisor have their own pages — send them home.
      router.push("/dashboard");
    }
  }, [status, session, router]);

  useEffect(() => {
    fetch("/api/designations").then((r) => r.ok ? r.json() : { designations: [] }).then((d) => setDesignations(d.designations || []));
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || isOversight(session)) return;
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session, search, designationId]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (designationId) params.set("designation_id", designationId);
    try {
      const r = await fetch(`/api/calls?${params}`);
      if (r.ok) setCalls((await r.json()).calls || []);
    } finally {
      setLoading(false);
    }
  }

  if (status !== "authenticated" || !session) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">My Calls</h1>
          <p className="text-gray-500 mt-2 font-medium">Every call you've logged. Newest first.</p>
        </div>
        <Link href="/dashboard/calls/new" className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-md">
          <Plus size={16} /> Log a Call
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-3 flex-wrap">
        <Search size={18} className="text-gray-400 ml-2" />
        <input
          type="text"
          placeholder="Search by name or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] outline-none text-sm py-2"
        />
        <select value={designationId} onChange={(e) => setDesignationId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All designations</option>
          {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>
        ) : calls.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Phone size={36} className="mx-auto text-gray-300 mb-3" />
            No calls yet. Click <Link href="/dashboard/workspace" className="text-[#164FA3] font-semibold hover:underline">Start Calling</Link> to begin.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold text-gray-600">When</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Person</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Phone</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Designation</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">District</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Sentiment</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 text-right">Duration</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id} className="border-t border-gray-100 hover:bg-blue-50/30 align-top">
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">
                      {new Date(c.called_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {c.person_name}
                      {c.is_vip ? <Star size={12} className="inline ml-1 text-[#FCB712] fill-[#FCB712]" /> : null}
                    </td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs">{c.phone_number}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{c.designation_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{c.district_name || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-[11px] font-semibold px-2 py-1 rounded-full border ${STATUS_PILL[c.status_name] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                        {c.status_name || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs">{c.sentiment ? SENTIMENT_LABEL[c.sentiment] : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">{fmtDur(c.duration_seconds)}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs">
                      <div className="line-clamp-2">{c.remarks || <span className="text-gray-300">—</span>}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && calls.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500 bg-gray-50">
            {calls.length} call{calls.length === 1 ? "" : "s"} logged
          </div>
        )}
      </div>
    </div>
  );
}
