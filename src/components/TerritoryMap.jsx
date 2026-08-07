"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Map as MapIcon, Loader2, Users, Network, PhoneCall, Activity, X, Contact, UserCog, TrendingUp, TrendingDown, Minus, ExternalLink } from "lucide-react";
import FloatingPopover from "@/components/FloatingPopover";

// The Organization Map, extracted from the former standalone /dashboard/map
// page so it can be embedded as a section of the dashboard. Same data source
// (/api/map), same tiles / detail panel / hover popover / auto-refresh — no
// duplicate implementation. Role access is unchanged: /api/map is oversight-
// gated and this only renders inside the oversight dashboards (SummaryDashboard).

const BAND_COLOR = {
  strong: "bg-emerald-500 hover:bg-emerald-600",
  medium: "bg-amber-500 hover:bg-amber-600",
  weak: "bg-red-500 hover:bg-red-600",
};

export default function TerritoryMap() {
  const [districts, setDistricts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const tileRefs = useRef({});

  useEffect(() => { load(); }, []);
  async function load() {
    const r = await fetch("/api/map");
    if (r.ok) setDistricts((await r.json()).districts || []);
    setLoading(false);
  }
  // Keep the map current without a manual refresh.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, []);

  const zones = useMemo(() => {
    const m = {};
    districts.forEach((d) => { (m[d.zone_name] = m[d.zone_name] || []).push(d); });
    return Object.entries(m);
  }, [districts]);

  const hovered = hoveredId ? districts.find((d) => d.id === hoveredId) : null;

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center"><MapIcon size={20} /></div>
          <div>
            <span className="font-bold text-lg text-gray-900">Organization Map</span>
            <p className="text-xs text-gray-400">Districts colored by organizational strength. Hover for a quick look, click a tile to drill down.</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Legend color="bg-emerald-500" label="Strong" />
          <Legend color="bg-amber-500" label="Medium" />
          <Legend color="bg-red-500" label="Weak" />
        </div>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>
      ) : districts.length === 0 ? (
        <div className="text-center py-12 text-gray-400"><MapIcon size={36} className="mx-auto text-gray-300 mb-3" />No territory data available.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {zones.map(([zone, items]) => (
              <div key={zone}>
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">{zone} Division</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {items.map((d) => (
                    <button
                      key={d.id}
                      ref={(el) => { tileRefs.current[d.id] = el; }}
                      onClick={() => setSelected(d)}
                      onMouseEnter={() => setHoveredId(d.id)}
                      onMouseLeave={() => setHoveredId((cur) => (cur === d.id ? null : cur))}
                      className={`${BAND_COLOR[d.band]} ${selected?.id === d.id ? "ring-4 ring-[#164FA3]/30" : ""} text-white rounded-xl p-4 text-left transition-all shadow-sm`}
                    >
                      <div className="font-bold text-sm leading-tight">{d.name}</div>
                      <div className="text-2xl font-bold mt-2">{d.score}</div>
                      <div className="text-xs opacity-90">{d.worker_count} workers</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-1">
            <div className="bg-gray-50 rounded-2xl border border-gray-100 p-6 sticky top-4">
              {!selected ? (
                <div className="text-center py-12 text-gray-400">
                  <MapIcon size={36} className="mx-auto text-gray-300 mb-3" />
                  Click a district tile to see its details.
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">{selected.name}</h3>
                      <p className="text-sm text-gray-500">{selected.zone_name} Division</p>
                    </div>
                    <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                  </div>
                  <div className={`mt-4 inline-block text-xs font-bold uppercase px-3 py-1 rounded-full text-white ${BAND_COLOR[selected.band].split(" ")[0]}`}>
                    {selected.band} · {selected.score}/100
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-6">
                    <Detail icon={Users} label="Total Members" value={selected.worker_count} />
                    <Detail icon={Activity} label="Active" value={selected.active_workers} />
                    <Detail icon={Activity} label="Pending" value={selected.pending_workers} />
                    <Detail icon={Activity} label="Inactive" value={selected.inactive_workers} />
                    <Detail icon={Network} label="Teams" value={selected.team_count} />
                    <Detail icon={UserCog} label="Callers" value={selected.caller_count} />
                    <Detail icon={Contact} label="Contacts" value={selected.contact_count} />
                    <Detail icon={PhoneCall} label="Call Completion" value={`${selected.call_completion_pct}%`} />
                    <Detail icon={Activity} label="Avg Activity" value={selected.avg_activity} />
                    <GrowthDetail value={selected.membership_growth_pct} />
                  </div>
                  {selected.band === "weak" && (
                    <div className="mt-5 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
                      ⚠ Weak area — needs more workers and team coverage.
                    </div>
                  )}
                  <a href="/dashboard/reports?module=workers" className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-[#164FA3] hover:underline">
                    View full report <ExternalLink size={13} />
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <FloatingPopover
        anchorRef={{ current: hoveredId ? tileRefs.current[hoveredId] : null }}
        open={!!hovered}
        onClose={() => setHoveredId(null)}
        width={220}
        estimatedHeight={190}
      >
        {hovered && (
          <div className="p-3 text-sm space-y-1">
            <div className="font-bold text-gray-900">{hovered.name}</div>
            <div className="text-xs text-gray-400 mb-1.5">{hovered.zone_name} Division · score {hovered.score}/100</div>
            <div className="flex justify-between"><span className="text-gray-500">Members</span><strong className="text-gray-800">{hovered.worker_count}</strong></div>
            <div className="flex justify-between"><span className="text-gray-500">Active / Pending</span><strong className="text-gray-800">{hovered.active_workers} / {hovered.pending_workers}</strong></div>
            <div className="flex justify-between"><span className="text-gray-500">Contacts</span><strong className="text-gray-800">{hovered.contact_count}</strong></div>
            <div className="flex justify-between"><span className="text-gray-500">Callers</span><strong className="text-gray-800">{hovered.caller_count}</strong></div>
            <div className="flex justify-between"><span className="text-gray-500">Call completion</span><strong className="text-gray-800">{hovered.call_completion_pct}%</strong></div>
          </div>
        )}
      </FloatingPopover>
    </div>
  );
}

function Legend({ color, label }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`w-3 h-3 rounded ${color}`} /><span className="text-gray-600">{label}</span></span>;
}
function Detail({ icon: Icon, label, value }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1"><Icon size={13} /> {label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}
function GrowthDetail({ value }) {
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  const color = value > 0 ? "text-emerald-600" : value < 0 ? "text-red-500" : "text-gray-400";
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1"><Icon size={13} /> Growth (30d)</div>
      <div className={`text-2xl font-bold ${color}`}>{value > 0 ? "+" : ""}{value}%</div>
    </div>
  );
}
