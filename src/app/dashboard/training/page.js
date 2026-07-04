"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { GraduationCap, PlayCircle, FileText, CheckCircle2, Loader2, Phone, Vote, Share2, Building2, Award } from "lucide-react";

const CATEGORY = {
  calling: { label: "Calling Training", icon: Phone, color: "text-blue-600 bg-blue-50" },
  booth: { label: "Polling Station Management", icon: Vote, color: "text-emerald-600 bg-emerald-50" },
  social_media: { label: "Social Media", icon: Share2, color: "text-pink-600 bg-pink-50" },
  organization: { label: "Organization", icon: Building2, color: "text-amber-600 bg-amber-50" },
};

export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => { if (status === "unauthenticated") router.push("/login"); }, [status, router]);
  if (status !== "authenticated" || !session) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body />;
}

function Body() {
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const r = await fetch("/api/training");
    if (r.ok) setModules((await r.json()).modules || []);
    setLoading(false);
  }
  async function setProgress(moduleId, pct) {
    await fetch("/api/training", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module_id: moduleId, progress_pct: pct }) });
    load();
  }

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;

  const cats = Object.keys(CATEGORY);
  const completed = modules.filter((m) => m.completed_at).length;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end flex-wrap gap-3">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Training Center</h1>
          <p className="text-gray-500 mt-2 font-medium">Build organizational capacity. {completed}/{modules.length} modules completed.</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-2 shadow-sm flex items-center gap-2">
          <Award size={18} className="text-[#FCB712]" />
          <span className="text-sm font-medium text-gray-700">{Math.round((completed / Math.max(1, modules.length)) * 100)}% complete</span>
        </div>
      </div>

      {cats.map((cat) => {
        const items = modules.filter((m) => m.category === cat);
        if (!items.length) return null;
        const meta = CATEGORY[cat];
        const Icon = meta.icon;
        return (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${meta.color}`}><Icon size={13} /> {meta.label}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {items.map((m) => {
                const pct = m.progress_pct || 0;
                const done = !!m.completed_at;
                return (
                  <div key={m.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-bold text-gray-900">{m.title}</h3>
                        <p className="text-sm text-gray-500 mt-1">{m.description}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                          {m.duration_min && <span className="flex items-center gap-1"><PlayCircle size={13} /> {m.duration_min} min</span>}
                          <span className="flex items-center gap-1"><FileText size={13} /> PDF</span>
                        </div>
                      </div>
                      {done && <CheckCircle2 size={22} className="text-emerald-500 shrink-0" />}
                    </div>
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-gray-500">Progress</span>
                        <span className="font-bold text-gray-700">{pct}%</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${done ? "bg-emerald-500" : "bg-[#164FA3]"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      {!done ? (
                        <>
                          {pct < 100 && <button onClick={() => setProgress(m.id, Math.min(100, pct + 50))} className="text-xs px-3 py-1.5 rounded-lg bg-[#164FA3] text-white font-semibold hover:bg-blue-800">{pct === 0 ? "Start" : "Continue"}</button>}
                          <button onClick={() => setProgress(m.id, 100)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Mark complete</button>
                        </>
                      ) : (
                        <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1"><Award size={14} /> Certificate earned (placeholder)</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
