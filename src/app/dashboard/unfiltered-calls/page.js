"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Phone, MessageCircle, CheckCircle2, Headphones } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { usePageGuard } from "@/components/usePageGuard";
import { isCaller } from "@/lib/permissions";
import { phoneActionLinks } from "@/lib/phoneLinks";

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

// One pending call: dial / WhatsApp, pick a call status, Mark Completed.
function CallRow({ c, statuses, onDone }) {
  const [statusId, setStatusId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const links = phoneActionLinks(c.phone_key);
  async function complete() {
    if (busy || !statusId) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/unfiltered-calls/${c.id}/complete`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status_id: Number(statusId), notes }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok && r.status !== 409) { setErr(d.message || "Could not save."); return; }
      onDone();
    } catch {
      setErr("Could not save — network error.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="border border-gray-200 rounded-xl p-3 sm:p-4 space-y-2" data-testid="ucall-row">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-900">{c.person_name || "Unnamed"}</div>
          <div className="text-sm font-mono text-gray-700" data-testid="ucall-phone">{c.phone_key}</div>
          <div className="text-xs text-gray-500">{[c.designation, c.assembly, c.district].filter(Boolean).join(" · ") || "—"}</div>
        </div>
        {links && (
          <div className="flex gap-2">
            <a href={links.tel} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#164FA3] text-white rounded-lg font-semibold"><Phone size={14} /> Call</a>
            <a href={links.whatsapp} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-700"><MessageCircle size={14} /> WhatsApp</a>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={statusId} onChange={(e) => setStatusId(e.target.value)} aria-label="Call status"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[180px] flex-1 sm:flex-none">
          <option value="">Call status…</option>
          {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" aria-label="Notes"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px]" />
        <button onClick={complete} disabled={busy || !statusId} data-testid="ucall-complete"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg font-semibold">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Mark Completed
        </button>
      </div>
      {err && <div className="text-xs text-red-600">{err}</div>}
    </li>
  );
}

export default function UnfilteredCallsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { ready, allowed } = usePageGuard("unfiltered_calls", isCaller(session));
  const [view, setView] = useState("pending");
  const [data, setData] = useState(null);
  const [statuses, setStatuses] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/unfiltered-calls?view=${view}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || "Could not load your calls."); return; }
      setErr(""); setData(d);
    } catch {
      setErr("Could not load your calls.");
    }
  }, [view]);
  useEffect(() => { if (ready && allowed) load(); }, [ready, allowed, load]);
  useEffect(() => {
    if (!ready || !allowed) return;
    // Existing call dispositions (one option per name).
    fetch("/api/statuses").then((r) => r.json()).then((d) => {
      const seen = new Set();
      setStatuses((d.statuses || []).filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true))));
    }).catch(() => {});
  }, [ready, allowed]);

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  const counts = data?.counts || { assigned: 0, completed: 0, pending: 0 };
  const tab = (k, label, n) => (
    <button onClick={() => setView(k)} data-testid={`ucall-tab-${k}`}
      className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${view === k ? "border-[#164FA3] text-[#164FA3]" : "border-transparent text-gray-500"}`}>
      {label} ({n})
    </button>
  );
  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      <PageHeader icon={Headphones} title="Unfiltered Calls" description="Unfiltered Contacts assigned to you." back={false} />
      <div className="grid grid-cols-3 gap-3" data-testid="ucall-counts">
        {[["Assigned", counts.assigned, "text-gray-900"], ["Completed", counts.completed, "text-emerald-700"], ["Pending", counts.pending, "text-amber-700"]].map(([l, v, c]) => (
          <div key={l} className="bg-white border border-gray-200 rounded-xl px-4 py-3"><div className={`text-2xl font-bold ${c}`}>{v}</div><div className="text-xs text-gray-500">{l}</div></div>
        ))}
      </div>
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="flex border-b border-gray-200 px-2">{tab("pending", "Pending", counts.pending)}{tab("completed", "Completed", counts.completed)}</div>
        <div className="p-3 sm:p-4">
          {err && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{err}</div>}
          {!data ? (
            <div className="py-8 text-center"><Loader2 className="animate-spin inline text-gray-400" /></div>
          ) : data.calls.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">{view === "pending" ? "No pending calls." : "No completed calls yet."}</div>
          ) : view === "pending" ? (
            <ul className="space-y-3">{data.calls.map((c) => <CallRow key={c.id} c={c} statuses={statuses} onDone={load} />)}</ul>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.calls.map((c) => (
                <li key={c.id} className="py-2.5 flex flex-wrap items-center gap-x-3 text-sm" data-testid="ucall-done-row">
                  <span className="font-medium text-gray-900">{c.person_name || "Unnamed"}</span>
                  <span className="font-mono text-gray-600">{c.phone_key}</span>
                  <span className="text-emerald-700">{c.call_status_name}</span>
                  {c.call_notes && <span className="text-gray-500 truncate max-w-xs">“{c.call_notes}”</span>}
                  <span className="ml-auto text-xs text-gray-400">{fmtDate(c.completed_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
