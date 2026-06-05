"use client";

import { useEffect, useState, useMemo } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { Map as MapIcon, Loader2, Users, Network, PhoneCall, Activity, X } from "lucide-react";

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

const BAND_COLOR = {
  strong: "bg-emerald-500 hover:bg-emerald-600",
  medium: "bg-amber-500 hover:bg-amber-600",
  weak: "bg-red-500 hover:bg-red-600",
};

function Body() {
  const [districts, setDistricts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetch("/api/map").then((r) => r.json()).then((d) => setDistricts(d.districts || [])).finally(() => setLoading(false));
  }, []);

  const zones = useMemo(() => {
    const m = {};
    districts.forEach((d) => { (m[d.zone_name] = m[d.zone_name] || []).push(d); });
    return Object.entries(m);
  }, [districts]);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Organization Map</h1>
        <p className="text-gray-500 mt-2 font-medium">Chhattisgarh districts colored by organizational strength. Click a tile to drill down.</p>
      </div>

      <div className="flex items-center gap-4 text-sm">
        <Legend color="bg-emerald-500" label="Strong" />
        <Legend color="bg-amber-500" label="Medium" />
        <Legend color="bg-red-500" label="Weak" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {zones.map(([zone, items]) => (
            <div key={zone}>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">{zone} Division</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {items.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelected(d)}
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
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sticky top-4">
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
                  <Detail icon={Users} label="Workers" value={selected.worker_count} />
                  <Detail icon={Activity} label="Active" value={selected.active_workers} />
                  <Detail icon={Network} label="Teams" value={selected.team_count} />
                  <Detail icon={PhoneCall} label="Calls" value={selected.call_count} />
                  <Detail icon={Activity} label="Avg Activity" value={selected.avg_activity} />
                </div>
                {selected.band === "weak" && (
                  <div className="mt-5 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
                    ⚠ Weak area — needs more workers and team coverage.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
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
