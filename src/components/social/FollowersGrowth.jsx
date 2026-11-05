"use client";

import { useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";
import CommonPDFExportButton from "@/components/common/CommonPDFExportButton";
import { todayIST, monthsBefore, fmtDMY } from "@/lib/socialDates";

const n = (v) => Number(v).toLocaleString("en-IN");
const PLATFORMS = [["", "All platforms"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["twitter", "Twitter / X"]];

// Followers Growth & Comparison (Pages tab): follower count at the start vs the end of a chosen period, per page and in total.
export default function FollowersGrowth() {
  const today = useMemo(() => todayIST(), []);
  const [preset, setPreset] = useState(1);             // 1 | 2 | 3 months, or null for a custom range
  const [start, setStart] = useState(() => monthsBefore(todayIST(), 1));
  const [end, setEnd] = useState(today);
  const [platform, setPlatform] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const invalid = !start || !end ? "Choose a Start Date and an End Date." : start > end ? "Start Date cannot be later than End Date." : end > today ? "End Date cannot be in the future." : "";
  const qs = `start=${start}&end=${end}${platform ? `&platform=${platform}` : ""}`;

  useEffect(() => {
    if (invalid) { setData(null); setError(""); return; }
    let alive = true;
    setLoading(true); setError("");
    fetch(`/api/social-management/followers-growth?${qs}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!alive) return; if (!r.ok) { setData(null); setError(d.message || "Could not load."); } else setData(d); })
      .catch(() => alive && setError("Could not load."))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [qs, invalid]);

  const pickPreset = (m) => { setPreset(m); setEnd(today); setStart(monthsBefore(today, m)); };
  const t = data?.totals;
  const tone = (g) => (g > 0 ? "text-emerald-700 bg-emerald-50" : g < 0 ? "text-red-700 bg-red-50" : "text-gray-700 bg-gray-100");
  const Icon = (g) => (g > 0 ? TrendingUp : g < 0 ? TrendingDown : Minus);
  const label = (g) => (g > 0 ? `+${n(g)}` : g < 0 ? `-${n(Math.abs(g))}` : "0");

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3" data-testid="followers-growth">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-gray-900">Followers Growth &amp; Comparison</h3>
          <p className="text-xs text-gray-500">Recorded follower count at the start and at the end of the period (nearest record on or before each date).</p>
        </div>
        <CommonPDFExportButton
          filename={`followers-growth-${start}-to-${end}.pdf`}
          fetchUrl={() => `/api/social-management/followers-growth?${qs}&format=pdf`}
          label="Export PDF"
        />
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        {[1, 2, 3].map((m) => (
          <button key={m} onClick={() => pickPreset(m)} data-testid={`fg-${m}m`} aria-pressed={preset === m}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${preset === m ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-700 border-gray-200 hover:border-[#164FA3]"}`}>
            {m} Month{m > 1 ? "s" : ""}
          </button>
        ))}
        <label className="text-xs text-gray-500">Start Date
          <input type="date" value={start} max={end || today} onChange={(e) => { setPreset(null); setStart(e.target.value); }} data-testid="fg-start" className="block mt-0.5 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900" /></label>
        <label className="text-xs text-gray-500">End Date
          <input type="date" value={end} max={today} onChange={(e) => { setPreset(null); setEnd(e.target.value); }} data-testid="fg-end" className="block mt-0.5 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900" /></label>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} data-testid="fg-platform" className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
          {PLATFORMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      <div className="text-sm text-gray-700" data-testid="fg-range">Selected period: <strong>{start && end ? `${fmtDMY(start)} to ${fmtDMY(end)}` : "—"}</strong></div>
      {(invalid || error) && <div className="text-sm text-red-600" data-testid="fg-error">{invalid || error}</div>}
      {loading && <Loader2 size={16} className="animate-spin text-[#164FA3]" />}

      {!invalid && !error && t && (
        <>
          {t.compared === 0 ? (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3" data-testid="fg-unavailable">
              Follower history is not available for this period, so no growth can be shown. Follower counts are recorded from the day each page&apos;s count is first saved.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl bg-gray-50 p-3"><div className="text-xs text-gray-500">Starting Followers</div><div className="text-xl font-bold text-gray-900" data-testid="fg-start-total">{n(t.start_followers)}</div></div>
              <div className="rounded-xl bg-gray-50 p-3"><div className="text-xs text-gray-500">Current Followers</div><div className="text-xl font-bold text-gray-900" data-testid="fg-end-total">{n(t.end_followers)}</div></div>
              <div className={`rounded-xl p-3 ${tone(t.growth)}`}><div className="text-xs opacity-80">Followers Growth / Margin</div>
                <div className="text-xl font-bold flex items-center gap-1.5" data-testid="fg-growth-total">{(() => { const I = Icon(t.growth); return <I size={18} />; })()}{label(t.growth)}</div></div>
            </div>
          )}
          {t.unavailable > 0 && t.compared > 0 && <div className="text-xs text-amber-700" data-testid="fg-partial">{t.unavailable} of {t.pages} page{t.pages === 1 ? "" : "s"} {t.unavailable === 1 ? "has" : "have"} no follower record for this period and {t.unavailable === 1 ? "is" : "are"} left out of the totals.</div>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-1.5">Page / Account</th><th>Platform</th><th className="text-right">Starting</th><th className="text-right">Current</th><th className="text-right">Growth / Margin</th></tr></thead>
              <tbody>
                {data.rows.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-gray-400">No pages.</td></tr>}
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0" data-testid="fg-row">
                    <td className="py-1.5 font-medium text-gray-900">{r.handle}</td><td className="text-gray-600">{r.platform_label}</td>
                    {r.status === "ok" ? <>
                      <td className="text-right">{n(r.start_followers)}</td><td className="text-right">{n(r.end_followers)}</td>
                      <td className="text-right"><span className={`inline-block px-2 py-0.5 rounded font-semibold ${tone(r.growth)}`}>{label(r.growth)}</span></td>
                    </> : <td colSpan={3} className="text-right text-xs text-amber-700">Data unavailable — {r.note}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
