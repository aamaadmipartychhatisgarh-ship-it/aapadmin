"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Info, Loader2, Check, Clock, Headphones, UserCheck, UserCog, ShieldCheck,
  LayoutDashboard, Vote, Newspaper, Share2, Gauge, FileText, Users, Star,
  MessageSquare, ClipboardList, Lock, ScrollText, Database,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";

// About & Features — the in-product catalogue of every plugin (feature module):
// what each one does, its feature list with GREEN certification marks, a
// comparison chart against the best-in-class product, and any pending tasks.
// Data comes from /api/plugins (backend source of truth in src/lib/pluginCatalog)
// so the green marks shown here are the backend's, not a hand-kept copy.
const ICONS = {
  Headphones, UserCheck, UserCog, ShieldCheck, Check, LayoutDashboard, Vote,
  Newspaper, Share2, Gauge, FileText, Users, Star, MessageSquare, ClipboardList,
  Lock, ScrollText, Database,
};
const BRAND = "#164FA3";

function Bars({ dims, aap, best }) {
  return (
    <div className="space-y-2">
      {dims.map((d, i) => (
        <div key={d}>
          <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
            <span className="truncate">{d}</span>
          </div>
          <div className="space-y-1">
            <Bar label="This platform" value={aap[i]} color={BRAND} />
            <Bar label="Best-in-class" value={best[i]} color="#9ca3af" />
          </div>
        </div>
      ))}
    </div>
  );
}
function Bar({ label, value, color }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[86px] shrink-0 text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden min-w-0">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
      </div>
      <span className="w-8 shrink-0 text-right text-[11px] font-semibold text-gray-600 tabular-nums">{value}</span>
    </div>
  );
}

function PluginCard({ p, dims }) {
  const Icon = ICONS[p.icon] || Info;
  const allGreen = p.features.every((f) => f.done) && (!p.pending || p.pending.length === 0);
  const exceed = p.verdict === "exceed";
  return (
    <article className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center shrink-0">
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-gray-900 leading-tight">{p.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{p.purpose}</p>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide rounded-full px-2.5 py-1 border ${allGreen ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-amber-700 bg-amber-50 border-amber-200"}`}>
          <Check size={12} /> {allGreen ? "Certified" : "In progress"}
        </span>
      </div>

      <ul className="space-y-1.5">
        {p.features.map((f) => (
          <li key={f.label} className="flex items-start gap-2 text-[13.5px] text-gray-700">
            {f.done ? (
              <span className="mt-0.5 w-4 h-4 shrink-0 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center">
                <Check size={10} />
              </span>
            ) : (
              <span className="mt-0.5 w-4 h-4 shrink-0 rounded-full bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center">
                <Clock size={10} />
              </span>
            )}
            <span>{f.label}</span>
          </li>
        ))}
      </ul>

      <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] uppercase tracking-wide text-gray-400">Vs {p.benchmark}</span>
          <span className={`text-[11px] font-bold uppercase tracking-wide rounded px-2 py-0.5 ${exceed ? "text-white bg-[#164FA3]" : "text-emerald-700 bg-emerald-50 border border-emerald-200"}`}>
            {exceed ? "Exceeds" : "Meets"}
          </span>
        </div>
        <Bars dims={dims} aap={p.scores.aap} best={p.scores.best} />
      </div>

      <div className="mt-auto">
        {p.pending && p.pending.length > 0 ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-1.5">Pending tasks</div>
            <ul className="space-y-1">
              {p.pending.map((t) => (
                <li key={t} className="flex items-start gap-2 text-[12.5px] text-amber-800">
                  <Clock size={12} className="mt-0.5 shrink-0" /> <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[12.5px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
            <Check size={14} /> Fully certified — no pending tasks.
          </div>
        )}
        {p.note && (
          <div className="mt-2 flex items-start gap-2 text-[11.5px] text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
            <Info size={12} className="mt-0.5 shrink-0" /> <span>{p.note}</span>
          </div>
        )}
      </div>
    </article>
  );
}

export default function AboutPluginsPage() {
  const { status } = useSession();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    let active = true;
    fetch("/api/plugins", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (active) setData(d); })
      .catch(() => { if (active) setErr("Could not load the plugin catalogue."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const stats = data?.stats;
  const KPIS = stats
    ? [
        { n: stats.plugins, l: "Plugins" },
        { n: `${stats.featuresDone}/${stats.features}`, l: "Features green" },
        { n: stats.fullyGreen, l: "Fully certified" },
        { n: stats.exceed, l: "Exceed benchmark" },
      ]
    : [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={Info}
        title="About & Features"
        description="Every plugin, its features, and how it compares to the best"
        breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "About & Features" }]}
      />

      <p className="text-sm text-gray-500 max-w-3xl">
        Each plugin below lists its features with a green certification mark, a comparison chart against
        the best-in-class product in its category, and any pending tasks. This is the living record of
        what the platform does — so capability can be confirmed here instead of testing every feature by hand.
      </p>

      {err && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">{err}</div>}

      {loading ? (
        <div className="py-20 text-center"><Loader2 className="inline animate-spin text-[#164FA3]" size={26} /></div>
      ) : (
        <>
          {KPIS.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {KPIS.map((k) => (
                <div key={k.l} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <div className="text-3xl font-bold text-[#164FA3] tabular-nums leading-none">{k.n}</div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide mt-1.5">{k.l}</div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {(data?.plugins || []).map((p) => (
              <PluginCard key={p.key} p={p} dims={data.dims} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
