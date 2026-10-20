"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

// Shows the Worker (contact) behind the complaint's mobile number and the Assembly
// mapped to that Worker — read-only, fetched from /api/complaints/worker-lookup as
// soon as a full number is entered. The server re-derives the Assembly on save, so
// this is display + (when several workers share a number) the explicit choice.
//   onResolved({ contactId, assemblyId })  – contactId is set when a worker is known
export default function ComplaintWorkerAssembly({ phone, savedAssemblyName, onResolved }) {
  const digits = String(phone || "").replace(/\D/g, "");
  const ready = digits.length >= 10;
  const [state, setState] = useState({ key: "", status: "idle", workers: [], assembly: null });
  const [picked, setPicked] = useState({ key: "", id: "" });

  const key = ready ? digits.slice(-10) : "";
  useEffect(() => {
    if (!ready) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      fetch(`/api/complaints/worker-lookup?phone=${encodeURIComponent(phone)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { status: "error", workers: [], assembly: null }))
        .then((d) => { if (alive) setState({ key, status: d.status || "error", workers: d.workers || [], assembly: d.assembly || null }); })
        .catch(() => { if (alive) setState({ key, status: "error", workers: [], assembly: null }); });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Results belong to the number they were fetched for; anything else is stale.
  const fresh = ready && state.key === key;
  const loading = ready && !fresh;
  const status = fresh ? state.status : "idle";
  const chosen = picked.key === key ? picked.id : "";
  const chosenWorker = state.workers.find((w) => String(w.id) === String(chosen));

  useEffect(() => {
    if (!onResolved) return;
    if (status === "unique" && state.workers.length === 1) onResolved({ contactId: state.workers[0].id, assemblyId: state.assembly?.id ?? null });
    else if (status === "unique") onResolved({ contactId: null, assemblyId: state.assembly?.id ?? null });
    else if (status === "multiple" && chosenWorker) onResolved({ contactId: chosenWorker.id, assemblyId: chosenWorker.assembly_id ?? null });
    else onResolved({ contactId: null, assemblyId: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, key, chosen, state.assembly?.id]);

  const box = "rounded-lg border px-3 py-2 text-sm";
  if (!ready) {
    return savedAssemblyName
      ? <div className={`${box} border-gray-200 bg-gray-50 text-gray-700`}><span className="text-xs text-gray-500">Assembly</span><div className="font-semibold">{savedAssemblyName}</div></div>
      : null;
  }
  if (loading) return <div className={`${box} border-gray-200 bg-gray-50 text-gray-500 flex items-center gap-2`}><Loader2 size={14} className="animate-spin" /> Looking up worker…</div>;
  if (status === "none") return <div className={`${box} border-gray-200 bg-gray-50 text-gray-500`}>No matching worker found for this number — no Assembly will be saved.</div>;
  if (status === "error") return <div className={`${box} border-red-200 bg-red-50 text-red-700`}>Could not look up the worker. The complaint can still be saved without an Assembly.</div>;
  if (status === "multiple") {
    return (
      <div className={`${box} border-amber-200 bg-amber-50 text-amber-900 space-y-1.5`}>
        <div className="text-xs font-semibold">Several workers use this number — choose the right one so the correct Assembly is saved.</div>
        <select className="w-full border border-amber-200 rounded-lg px-2 py-1.5 text-sm bg-white" value={chosen} onChange={(e) => setPicked({ key, id: e.target.value })}>
          <option value="">Select worker…</option>
          {state.workers.map((w) => <option key={w.id} value={w.id}>{w.name} — {w.assembly_name || "no Assembly recorded"}</option>)}
        </select>
        {chosenWorker && <div className="text-xs">Assembly: <strong>{chosenWorker.assembly_name || "not recorded for this worker"}</strong></div>}
      </div>
    );
  }
  const w = state.workers[0];
  return (
    <div className={`${box} border-emerald-200 bg-emerald-50 text-emerald-900`}>
      <div className="text-xs text-emerald-700">Worker: <strong>{w?.name}</strong></div>
      <div><span className="text-xs text-emerald-700">Assembly </span><span className="font-semibold">{state.assembly?.name || "not recorded for this worker"}</span></div>
    </div>
  );
}
