"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Phone, Loader2 } from "lucide-react";

// "DD Mon YYYY" from a YYYY-MM-DD string, no timezone shift (same as the Influencer page).
function fmt(v) {
  const [y, m, d] = String(v || "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(y, m - 1, d));
}

// Supervisor dashboard card: influencers assigned to the signed-in supervisor whose
// Follow-up Date is tomorrow. The API decides who sees what (403 → renders nothing).
export default function InfluencerFollowUpReminders() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/influencers/follow-up-reminders", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setData(d || { reminders: [], hidden: true }); })
      .catch(() => { if (alive) setData({ reminders: [], hidden: true }); });
    return () => { alive = false; };
  }, []);
  if (!data) return <div className="text-gray-400"><Loader2 className="animate-spin inline" size={16} /></div>;
  if (data.hidden || !data.reminders.length) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden" data-testid="influencer-followups">
      <div className="px-4 py-3 border-b border-amber-200 flex items-center gap-2">
        <CalendarClock size={17} className="text-amber-700" />
        <h2 className="text-sm font-bold text-gray-900">Influencer Follow-ups</h2>
        <span className="text-xs font-semibold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">{data.reminders.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Influencer</th>
              <th className="px-4 py-2 font-semibold">Phone</th>
              <th className="px-4 py-2 font-semibold">Party Joined By</th>
              <th className="px-4 py-2 font-semibold">Follow-up Date</th>
              <th className="px-4 py-2 font-semibold">Remark</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100 bg-white">
            {data.reminders.map((r) => (
              <tr key={r.id} data-testid="influencer-followup-row">
                <td className="px-4 py-2.5 align-top">
                  <div className="font-medium text-gray-900">{r.name}</div>
                  <div className="text-xs text-gray-500">{[r.assembly_name, r.current_party].filter(Boolean).join(" · ")}</div>
                  <span className="inline-block mt-1 text-[11px] font-semibold text-amber-800 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
                    {r.label} · {r.label_hi}
                  </span>
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
