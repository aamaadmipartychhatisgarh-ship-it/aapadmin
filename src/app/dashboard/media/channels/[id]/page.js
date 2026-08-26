"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import SupervisorGuard from "@/components/SupervisorGuard";
import { canAccessMedia } from "@/lib/permissions";
import { ArrowLeft, Tv, Plus, Loader2, Pencil, Trash2, FileText, Calendar } from "lucide-react";
import { DebateModal } from "@/app/dashboard/media/page";

export default function Page({ params }) {
  const { id } = use(params);
  return <SupervisorGuard allow={canAccessMedia}><Body channelId={id} /></SupervisorGuard>;
}

const TONE = { supportive: "bg-emerald-100 text-emerald-700", neutral: "bg-gray-100 text-gray-600", opposing: "bg-red-100 text-red-700", unknown: "bg-amber-100 text-amber-700" };
function debateStart(d) {
  if (!d?.debate_date) return null;
  const date = String(d.debate_date).slice(0, 10);
  let t = d.debate_time ? String(d.debate_time).slice(0, 8) : "12:00:00";
  if (t.length === 5) t += ":00";
  const dt = new Date(`${date}T${t}`);
  return isNaN(dt.getTime()) ? null : dt;
}
function fmtWhen(d) {
  const s = debateStart(d);
  if (!s) return "—";
  return `${s.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} @ ${s.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

function Body({ channelId }) {
  const [detail, setDetail] = useState(null);   // { channel, debates }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState({ channels: [], spokespersons: [] }); // for the debate modal
  const [modal, setModal] = useState(null); // 'new' | debate

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`/api/media/channels/${channelId}/detail`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || "Failed to load the channel.");
      setDetail(d);
    } catch (e) { setError(e.message); setDetail(null); } finally { setLoading(false); }
  }, [channelId]);
  useEffect(() => { load(); }, [load]);

  // Channels + spokespersons for the Schedule/Edit Debate modal.
  useEffect(() => {
    let alive = true;
    fetch("/api/media", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (alive && d) setMeta({ channels: d.channels || [], spokespersons: d.spokespersons || [] });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  async function del(d) {
    if (!confirm(`Delete this debate?\n\n${d.topic || "Debate"}`)) return;
    try {
      const r = await fetch(`/api/media/debates/${d.id}`, { method: "DELETE" });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.message || "Delete failed"); }
      load();
    } catch (e) { alert(e.message); }
  }

  const ch = detail?.channel;
  const debates = detail?.debates || [];
  const now = Date.now();
  const upcoming = debates
    .filter((d) => d.status !== "cancelled" && d.status !== "aired")
    .map((d) => ({ d, s: debateStart(d) }))
    .filter((x) => x.s && x.s.getTime() >= now - 3 * 3600000)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.d);

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <Link href="/dashboard/media" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#164FA3]"><ArrowLeft size={15} /> Back to News Channels</Link>

      {loading ? (
        <div className="flex h-48 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-700 text-sm">{error} <button onClick={load} className="ml-2 font-semibold underline">Retry</button></div>
      ) : ch ? (
        <>
          {/* Channel header — name, Lok Sabha, tone. Debate List only VIEWS/manages
              existing debates (BUG 23): scheduling happens from the channel card
              (Schedule Debate), so there is no Add/Schedule button here. */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center"><Tv size={24} /></div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{ch.name}</h1>
                <div className="text-sm text-gray-500 flex items-center gap-2 mt-0.5">
                  <span>Lok Sabha: <span className="font-medium text-gray-700">{ch.lok_sabha_name || "—"}</span></span>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${TONE[ch.tone] || TONE.unknown}`}>{ch.tone}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Upcoming debates */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-3"><Calendar size={16} className="text-[#164FA3]" /> Upcoming Debates</h3>
            {upcoming.length === 0 ? (
              <div className="text-sm text-gray-400">No upcoming debates for this channel.</div>
            ) : (
              <div className="space-y-2">
                {upcoming.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 flex-wrap rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-sm">
                    <span className="font-semibold text-gray-900">{d.topic || "Debate"}</span>
                    <span className="text-gray-600">{fmtWhen(d)}</span>
                    <span className="text-gray-500">{(d.spokespersons || []).map((s) => s.name).join(", ") || "No spokesperson"}</span>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 ml-auto">{d.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Debate List */}
          <div>
            <h3 className="font-bold text-gray-900 mb-2">Debate List</h3>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {debates.length === 0 ? (
                <div className="p-8 text-gray-400 text-sm text-center">No debates scheduled for this channel yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left">
                      <tr>
                        <th className="px-4 py-3 font-semibold text-gray-600">Title</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Channel</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Lok Sabha</th>
                        <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Date / Time</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Spokesperson</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                        <th className="px-4 py-3 font-semibold text-gray-600">Brief</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {debates.map((d) => (
                        <tr key={d.id} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{d.topic}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{ch.name}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{ch.lok_sabha_name || <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtWhen(d)}</td>
                          <td className="px-4 py-3 text-gray-600">{(d.spokespersons || []).length ? d.spokespersons.map((s) => s.name).join(", ") : <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-3"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${d.status === "aired" ? "bg-blue-100 text-blue-700" : d.status === "live" ? "bg-red-100 text-red-700" : d.status === "cancelled" ? "bg-gray-100 text-gray-400" : "bg-amber-100 text-amber-700"}`}>{d.status}</span></td>
                          <td className="px-4 py-3">{d.brief_pdf_url ? <a href={d.brief_pdf_url} target="_blank" rel="noreferrer" className="text-[#164FA3] hover:underline text-xs flex items-center gap-1"><FileText size={13} /> PDF</a> : <span className="text-gray-300">—</span>}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <button onClick={() => setModal(d)} title="Edit debate" className="p-1.5 text-gray-400 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg"><Pencil size={13} /></button>
                            <button onClick={() => del(d)} title="Delete debate" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={13} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}

      {modal && ch && (
        <DebateModal
          editing={modal === "new" ? null : modal}
          defaultChannelId={ch.id}
          channels={meta.channels.length ? meta.channels : [ch]}
          spokespersons={meta.spokespersons}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
