"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Phone, Loader2, FileSpreadsheet, Search } from "lucide-react";

// "DD Mon YYYY" from a YYYY-MM-DD string, no timezone shift (same as the Influencer page).
function fmt(v) {
  const [y, m, d] = String(v || "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(y, m - 1, d));
}

const RANGES = [
  { v: "all", label: "All upcoming" },
  { v: "today", label: "Today" },
  { v: "tomorrow", label: "Tomorrow" },
  { v: "7", label: "Next 7 days" },
  { v: "30", label: "Next 30 days" },
];
// Show Export once the Supervisor-2 has MORE than this many upcoming follow-ups.
const EXPORT_AFTER = 5;

// Supervisor-2 dashboard section: the signed-in supervisor's upcoming influencer
// follow-ups (Follow-up Date today or later). The API decides who sees what — a
// 403 renders nothing — and the Excel export uses the same filters + endpoint rules.
export default function InfluencerFollowUpReminders() {
  const [range, setRange] = useState("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const qs = new URLSearchParams({ range, ...(q ? { search: q } : {}) }).toString();
  useEffect(() => {
    let alive = true;
    fetch(`/api/influencers/follow-up-reminders?${qs}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setData(d || { reminders: [], available: 0, hidden: true }); })
      .catch(() => { if (alive) setData({ reminders: [], available: 0, hidden: true }); });
    return () => { alive = false; };
  }, [qs]);
  if (!data) return <div className="text-gray-400"><Loader2 className="animate-spin inline" size={16} /></div>;
  // Nothing upcoming at all (or not this supervisor's feature) → no section.
  if (data.hidden || !data.available) return null;
  const rows = data.reminders;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden" data-testid="influencer-followups">
      <div className="px-4 py-3 border-b border-amber-200 flex flex-wrap items-center gap-2">
        <CalendarClock size={17} className="text-amber-700" />
        <h2 className="text-sm font-bold text-gray-900">Influencer Follow-ups</h2>
        <span className="text-xs font-semibold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5" data-testid="followup-count">{rows.length}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or phone" data-testid="followup-search"
              className="h-8 w-40 pl-7 pr-2 rounded-lg border border-amber-200 bg-white text-xs" />
          </div>
          <select value={range} onChange={(e) => setRange(e.target.value)} data-testid="followup-range"
            className="h-8 rounded-lg border border-amber-200 bg-white text-xs px-2 text-gray-700">
            {RANGES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
          </select>
          {data.available > EXPORT_AFTER && (
            <a href={`/api/influencers/follow-up-reminders/export?${qs}`} data-testid="followup-export"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#164FA3] text-white text-xs font-semibold hover:bg-blue-800">
              <FileSpreadsheet size={14} /> Export to Excel
            </a>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Influencer Name</th>
              <th className="px-4 py-2 font-semibold">Phone Number</th>
              <th className="px-4 py-2 font-semibold">Party Joined By – Name</th>
              <th className="px-4 py-2 font-semibold">Follow-up Date</th>
              <th className="px-4 py-2 font-semibold">Remark</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100 bg-white">
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No follow-ups match the filter.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} data-testid="influencer-followup-row">
                <td className="px-4 py-2.5 align-top">
                  <div className="font-medium text-gray-900">{r.name}</div>
                  <div className="text-xs text-gray-500">{[r.assembly_name, r.current_party].filter(Boolean).join(" · ")}</div>
                  {r.label && (
                    <span className="inline-block mt-1 text-[11px] font-semibold text-amber-800 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
                      {r.label} · {r.label_hi}
                    </span>
                  )}
                  {r.when === "today" && <span className="inline-block mt-1 text-[11px] font-semibold text-green-800 bg-green-100 border border-green-200 rounded-full px-2 py-0.5">Today</span>}
                </td>
                <td className="px-4 py-2.5 align-top text-gray-700 font-mono text-xs">{r.phone || "—"}</td>
                <td className="px-4 py-2.5 align-top">
                  {r.joined_by_name || r.joined_by_phone ? (
                    <>
                      <div className="text-gray-900">{[r.joined_by_name, r.joined_by_designation].filter(Boolean).join(" – ") || "—"}</div>
                      {r.joined_by_phone && <div className="text-[11px] text-gray-400 inline-flex items-center gap-1"><Phone size={10} /> {r.joined_by_phone}</div>}
                    </>
                  ) : "—"}
                </td>
                <td className="px-4 py-2.5 align-top whitespace-nowrap text-gray-800 font-medium">{fmt(r.follow_up_date)}</td>
                <td className="px-4 py-2.5 align-top text-gray-700 whitespace-pre-wrap break-words max-w-[320px]">{r.remark || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
