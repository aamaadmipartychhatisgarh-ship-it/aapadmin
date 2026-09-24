"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2, ChevronRight, Home, UserPlus, UserCheck, UserX, Search, X, CheckCircle2,
  Network, Phone, CornerDownRight,
} from "lucide-react";

const BRAND = "#164FA3";
const inp = "h-9 rounded-lg border border-gray-200 text-sm px-3 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300";

// Administration → Designation Chain. A true parent-child appointment chain
// (State → Lok Sabha → District → Assembly → Block) for five roles. Each parent
// appoints the SAME role at its own sub-units only — the navigator drills down
// one org unit at a time and lets you appoint/change/vacate each child slot.
export default function DesignationChain() {
  const [chains, setChains] = useState([]);
  const [levelLabels, setLevelLabels] = useState({});
  const [chain, setChain] = useState("president");
  const [summary, setSummary] = useState(null);
  const [root, setRoot] = useState(null);          // the State node
  const [path, setPath] = useState([]);            // drill-down breadcrumb (excludes root)
  const [current, setCurrent] = useState(null);    // node whose children we're showing
  const [childLevel, setChildLevel] = useState(null);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [appoint, setAppoint] = useState(null);    // slot being appointed | null
  const [toast, setToast] = useState(null);

  const flash = (type, text) => { setToast({ type, text }); setTimeout(() => setToast(null), 3000); };

  // Load a node's children. `node` null → the State root.
  const loadNode = useCallback(async (node) => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ chain });
      if (node && node.level !== "state") { p.set("level", node.level); p.set("location_id", String(node.location_id)); }
      const r = await fetch(`/api/designation-chain?${p}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash("error", d.message || "Could not load the chain."); return; }
      if (d.summary) setSummary(d.summary);
      if (d.chains) setChains(d.chains);
      if (d.level_labels) setLevelLabels(d.level_labels);
      if (d.root) setRoot(d.root);
      setChildLevel(d.child_level || null);
      setChildren(d.children || []);
    } finally { setLoading(false); }
  }, [chain]);

  // Reset to the State root whenever the chain changes.
  useEffect(() => {
    setPath([]); setCurrent(null);
    loadNode(null);
  }, [chain, loadNode]);

  const reload = useCallback(() => loadNode(current), [loadNode, current]);

  function drillInto(slot) {
    setPath((p) => [...p, slot]);
    setCurrent(slot);
    loadNode(slot);
  }
  function goTo(index) {
    // index -1 = root (State); otherwise the path node at that index.
    if (index < 0) { setPath([]); setCurrent(null); loadNode(null); return; }
    const node = path[index];
    setPath((p) => p.slice(0, index + 1));
    setCurrent(node);
    loadNode(node);
  }

  const stateLabel = levelLabels.state || "State";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white" style={{ background: BRAND }}><Network size={20} /></div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Designation Chain</h2>
          <p className="text-sm text-gray-500">State → Lok Sabha → District → Assembly → Block. Each level appoints the same role at its own sub-units only.</p>
        </div>
      </div>

      {/* Chain (role) selector */}
      <div className="flex flex-wrap gap-2">
        {chains.map((c) => (
          <button key={c.key} onClick={() => setChain(c.key)}
            className={`h-9 px-3.5 rounded-lg text-sm font-semibold border transition-colors ${chain === c.key ? "text-white border-transparent" : "text-gray-600 border-gray-200 bg-white hover:bg-gray-50"}`}
            style={chain === c.key ? { background: BRAND } : undefined}>
            {c.role}
          </button>
        ))}
      </div>

      {/* Summary — filled / vacant per level */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {["state", "lok_sabha", "district", "assembly", "block"].map((lv) => {
            const s = summary[lv] || { total: 0, filled: 0, vacant: 0 };
            return (
              <div key={lv} className="bg-white border border-gray-200 rounded-xl px-3 py-2.5">
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{levelLabels[lv] || lv}</div>
                <div className="text-sm font-bold text-gray-900 mt-0.5">{s.filled}<span className="text-gray-300"> / {s.total}</span></div>
                <div className="text-[11px] text-gray-500">{s.vacant} vacant</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 flex-wrap text-sm">
        <button onClick={() => goTo(-1)} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-gray-600 hover:bg-gray-100 font-medium">
          <Home size={14} /> {stateLabel}
        </button>
        {path.map((n, i) => (
          <span key={`${n.level}:${n.location_id}`} className="inline-flex items-center gap-1">
            <ChevronRight size={14} className="text-gray-300" />
            <button onClick={() => goTo(i)} className={`px-2 py-1 rounded-md hover:bg-gray-100 ${i === path.length - 1 ? "text-gray-900 font-semibold" : "text-gray-600"}`}>
              {n.location_name}
            </button>
          </span>
        ))}
      </div>

      {/* Current-node holder card (the appointing authority). Editable only at the
          State root; deeper nodes are appointed from their parent's list. */}
      {current == null && root && (
        <HolderCard
          title={`${stateLabel} ${chains.find((c) => c.key === chain)?.role || ""}`}
          slot={{ chain_key: chain, level: "state", location_id: null, location_name: stateLabel }}
          holder={root.holder} editable
          onAppoint={() => setAppoint({ chain_key: chain, level: "state", location_id: null, location_name: stateLabel })}
          onVacate={() => vacate({ chain_key: chain, level: "state", location_id: null }, reload, flash)}
        />
      )}
      {current && (
        <HolderCard
          title={`${levelLabels[current.level] || current.level} ${chains.find((c) => c.key === chain)?.role || ""} — ${current.location_name}`}
          slot={current} holder={current.holder} editable={false}
        />
      )}

      {/* Children list — the appointable sub-units of the current node */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <CornerDownRight size={15} style={{ color: BRAND }} />
          <h3 className="text-sm font-bold text-gray-900">
            {childLevel ? `${levelLabels[childLevel] || childLevel} ${chains.find((c) => c.key === chain)?.role || ""}s` : "No lower level"}
          </h3>
          <span className="ml-auto text-xs text-gray-400">{children.length ? `${children.length} unit${children.length > 1 ? "s" : ""}` : ""}</span>
        </div>
        {loading ? (
          <div className="px-4 py-14 text-center text-gray-400"><Loader2 className="animate-spin inline" size={22} /></div>
        ) : !childLevel ? (
          <div className="px-4 py-10 text-center text-gray-400 text-sm">Block is the lowest level in the chain.</div>
        ) : children.length === 0 ? (
          <div className="px-4 py-10 text-center text-gray-400 text-sm">No {levelLabels[childLevel] || childLevel} units exist under this {levelLabels[current?.level || "state"] || "unit"} in the Location Master.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {children.map((slot) => (
              <li key={`${slot.level}:${slot.location_id}`} className="px-4 py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 text-sm truncate">{slot.location_name}</span>
                    {slot.filled
                      ? <span className="text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5 inline-flex items-center gap-1"><UserCheck size={12} /> Filled</span>
                      : <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 inline-flex items-center gap-1"><UserX size={12} /> Vacant</span>}
                  </div>
                  {slot.holder && (
                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                      <span>{slot.holder.person_name}</span>
                      {slot.holder.mobile && <span className="inline-flex items-center gap-1 text-gray-400"><Phone size={11} /> {slot.holder.mobile}</span>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => setAppoint(slot)}
                    className="h-8 px-3 rounded-lg text-white text-xs font-semibold inline-flex items-center gap-1.5" style={{ background: BRAND }}>
                    <UserPlus size={13} /> {slot.filled ? "Change" : "Appoint"}
                  </button>
                  {slot.filled && (
                    <button onClick={() => vacate(slot, reload, flash)}
                      className="h-8 px-2.5 rounded-lg border border-gray-200 text-xs font-medium text-red-600 hover:bg-red-50">Vacate</button>
                  )}
                  {slot.has_children && (
                    <button onClick={() => drillInto(slot)} title="Open sub-units"
                      className="h-8 px-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"><ChevronRight size={15} /></button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {appoint && (
        <AppointModal
          slot={appoint} levelLabel={levelLabels[appoint.level] || appoint.level}
          onClose={() => setAppoint(null)}
          onDone={() => { setAppoint(null); reload(); flash("success", "Appointment saved."); }}
          onError={(m) => flash("error", m)}
        />
      )}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[140] px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.type === "success" ? <CheckCircle2 size={16} /> : <X size={16} />} {toast.text}
        </div>
      )}
    </div>
  );
}

async function vacate(slot, reload, flash) {
  if (!confirm(`Vacate this ${slot.location_name} post? Lower-level appointments are preserved.`)) return;
  try {
    const r = await fetch("/api/designation-chain", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "vacate", chain: slot.chain_key, level: slot.level, location_id: slot.location_id }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { flash("error", d.message || "Could not vacate."); return; }
    reload(); flash("success", "Post vacated.");
  } catch { flash("error", "Could not vacate."); }
}

function HolderCard({ title, slot, holder, editable, onAppoint, onVacate }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-[#164FA3] font-bold shrink-0">
        {String(holder?.person_name || "?").trim().charAt(0).toUpperCase() || "?"}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{title}</div>
        {holder ? (
          <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
            {holder.person_name}
            {holder.mobile && <span className="text-xs text-gray-400 inline-flex items-center gap-1"><Phone size={11} /> {holder.mobile}</span>}
          </div>
        ) : <div className="text-sm text-amber-600 font-medium">Vacant</div>}
      </div>
      {editable && (
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={onAppoint} className="h-8 px-3 rounded-lg text-white text-xs font-semibold inline-flex items-center gap-1.5" style={{ background: BRAND }}>
            <UserPlus size={13} /> {holder ? "Change" : "Appoint"}
          </button>
          {holder && <button onClick={onVacate} className="h-8 px-2.5 rounded-lg border border-gray-200 text-xs font-medium text-red-600 hover:bg-red-50">Vacate</button>}
        </div>
      )}
    </div>
  );
}

// Appoint a person into a slot. Candidates are restricted server-side to people
// who belong to this org unit, so a wrong-parent link is impossible.
function AppointModal({ slot, levelLabel, onClose, onDone, onError }) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const p = new URLSearchParams({ chain: slot.chain_key, candidates: "1", level: slot.level });
    if (slot.location_id != null) p.set("location_id", String(slot.location_id));
    if (debounced.trim()) p.set("search", debounced.trim());
    fetch(`/api/designation-chain?${p}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => { if (alive) setCandidates(d.candidates || []); })
      .catch(() => { if (alive) setCandidates([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slot, debounced]);

  async function choose(c) {
    setSaving(true);
    try {
      const r = await fetch("/api/designation-chain", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "appoint", chain: slot.chain_key, level: slot.level, location_id: slot.location_id, contact_id: c.contact_id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { onError(d.message || "Could not appoint."); setSaving(false); return; }
      onDone();
    } catch { onError("Could not appoint."); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">Appoint {levelLabel} — {slot.location_name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">Only people who belong to this {levelLabel} are listed, so the appointment is always linked to the correct unit.</p>
        </div>
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="relative">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone…" className={`${inp} w-full pl-8`} />
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="px-5 py-12 text-center text-gray-400"><Loader2 className="animate-spin inline" size={22} /></div>
          ) : candidates.length === 0 ? (
            <div className="px-5 py-12 text-center text-gray-400 text-sm">No contacts belong to this {levelLabel}. Set a contact&apos;s {levelLabel} in Contacts first, then appoint them here.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {candidates.map((c) => (
                <li key={c.contact_id}>
                  <button disabled={saving} onClick={() => choose(c)} className="w-full text-left px-5 py-2.5 hover:bg-gray-50 flex items-center gap-3 disabled:opacity-60">
                    <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-[#164FA3] font-bold text-sm shrink-0">
                      {String(c.person_name || "?").trim().charAt(0).toUpperCase() || "?"}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{c.person_name}</div>
                      {c.mobile && <div className="text-xs text-gray-400">{c.mobile}</div>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  );
}
