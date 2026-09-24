"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2, Plus, Pencil, Trash2, ChevronUp, ChevronDown, Check, X, Layers, Wand2, CheckCircle2,
} from "lucide-react";

const BRAND = "#164FA3";
const inp = "h-10 rounded-lg border border-gray-200 text-sm px-3 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300";

// Administration → Designation Master. Configure each Wing's base roles once; the
// system auto-generates the level-specific designations (State → Lok Sabha →
// District → Assembly) in the same order. Everything is stored in the master and
// generated into the shared designations table, so assignment/vacancy/reports use
// the same source.
export default function DesignationMaster() {
  const [wings, setWings] = useState([]);
  const [levels, setLevels] = useState([]);
  const [wingId, setWingId] = useState("");
  const [level, setLevel] = useState("state");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [newBase, setNewBase] = useState("");
  const [newWing, setNewWing] = useState("");
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");

  const flash = (type, text) => { setToast({ type, text }); setTimeout(() => setToast(null), 3000); };

  const loadWings = useCallback(async (selectFirst) => {
    const r = await fetch("/api/admin/designation-master", { cache: "no-store" });
    const d = await r.json();
    setWings(d.wings || []);
    setLevels(d.levels || []);
    if (selectFirst && !wingId && d.wings?.length) setWingId(String(d.wings[0].id));
  }, [wingId]);

  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/designation-master?wing_id=${id}`, { cache: "no-store" });
      const d = await r.json();
      setDetail(d);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadWings(true).finally(() => setLoading(false)); }, [loadWings]);
  useEffect(() => { if (wingId) loadDetail(wingId); }, [wingId, loadDetail]);

  async function post(body, okMsg) {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/designation-master", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash("error", d.message || "Could not save."); return null; }
      if (okMsg) flash("success", okMsg);
      return d;
    } catch { flash("error", "Could not save."); return null; }
    finally { setBusy(false); }
  }

  async function addWing() {
    const name = newWing.trim();
    if (!name) return;
    const d = await post({ action: "add_wing", name }, "Wing added.");
    if (d) { setNewWing(""); await loadWings(); if (d.id) setWingId(String(d.id)); }
  }
  async function addBase() {
    const base_name = newBase.trim();
    if (!base_name) return;
    const d = await post({ action: "add_base", wing_id: wingId, base_name }, "Designation added and generated across all levels.");
    if (d) { setNewBase(""); loadDetail(wingId); }
  }
  async function saveEdit() {
    const d = await post({ action: "edit_base", base_id: editId, base_name: editName.trim() }, "Designation updated.");
    if (d) { setEditId(null); setEditName(""); loadDetail(wingId); }
  }
  async function toggleBase(b) {
    const d = await post({ action: "toggle_base", base_id: b.id, enabled: b.enabled ? 0 : 1 }, b.enabled ? "Designation disabled." : "Designation enabled.");
    if (d) loadDetail(wingId);
  }
  async function deleteBase(b) {
    if (!confirm(`Delete "${b.base_name}" from this wing? Its generated designations will be disabled (never deleted), so any assigned person is preserved.`)) return;
    const d = await post({ action: "delete_base", base_id: b.id }, "Designation removed.");
    if (d) { if (d.had_assignments) flash("success", "Removed — generated designations with assigned people were disabled, not deleted."); loadDetail(wingId); }
  }
  async function move(idx, dir) {
    const bases = detail?.bases || [];
    const j = idx + dir;
    if (j < 0 || j >= bases.length) return;
    const order = bases.map((b) => b.id);
    [order[idx], order[j]] = [order[j], order[idx]];
    const d = await post({ action: "reorder", wing_id: wingId, order }, "Order updated.");
    if (d) loadDetail(wingId);
  }

  const wing = detail?.wing;
  const bases = detail?.bases || [];
  const isMain = !!wing?.is_main;
  const genLevel = detail?.generated?.levels?.[level] || [];
  const genMain = detail?.generated?.main || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white" style={{ background: BRAND }}><Layers size={20} /></div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Designation Master</h2>
          <p className="text-sm text-gray-500">Configure each Wing&apos;s base designations once — the system auto-generates them across State → Lok Sabha → District → Assembly in the same order.</p>
        </div>
      </div>

      {/* Wing selector + add wing */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Wing</label>
          <select value={wingId} onChange={(e) => setWingId(e.target.value)} className={inp} style={{ minWidth: 220 }}>
            {wings.map((w) => <option key={w.id} value={w.id}>{w.name}{w.is_main ? " (Main Organisation)" : ""}</option>)}
          </select>
        </div>
        <div className="ml-auto flex items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Add a new Wing</label>
            <input value={newWing} onChange={(e) => setNewWing(e.target.value)} className={inp} placeholder="New wing name" />
          </div>
          <button onClick={addWing} disabled={busy || !newWing.trim()} className="h-10 px-4 rounded-lg text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60" style={{ background: BRAND }}>
            <Plus size={16} /> Add Wing
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 flex justify-center"><Loader2 className="animate-spin" style={{ color: BRAND }} size={24} /></div>
      ) : isMain ? (
        // Main Organisation — the fixed State Administration designations (§1).
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-900">Main State Administration</h3>
            <p className="text-xs text-gray-400 mt-0.5">Fixed sequence — the core State designations (not level-generated).</p>
          </div>
          <ol className="divide-y divide-gray-100">
            {genMain.length === 0 ? <li className="px-4 py-6 text-sm text-gray-400">No designations.</li> :
              genMain.map((g, i) => (
                <li key={g.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                  <span className="w-6 text-right text-gray-400 font-mono text-xs">{i + 1}</span>
                  <span className="text-gray-900 font-medium">{g.name}</span>
                  {!g.enabled && <span className="ml-auto text-[11px] text-gray-400">disabled</span>}
                </li>
              ))}
          </ol>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Base designations editor */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900">{wing?.name} — Base Designations</h3>
              <p className="text-xs text-gray-400 mt-0.5">The role + order. Each is generated at every level automatically.</p>
            </div>
            <div className="divide-y divide-gray-100">
              {bases.length === 0 ? (
                <div className="px-4 py-6 text-sm text-gray-400">No designations yet. Add one below (e.g. President).</div>
              ) : bases.map((b, i) => (
                <div key={b.id} className={`px-4 py-2.5 flex items-center gap-2 ${b.enabled ? "" : "opacity-60"}`}>
                  <span className="w-6 text-right text-gray-400 font-mono text-xs">{i + 1}</span>
                  {editId === b.id ? (
                    <>
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} className={`${inp} h-8 flex-1`} autoFocus />
                      <button onClick={saveEdit} disabled={busy} className="p-1.5 rounded-md text-green-600 hover:bg-green-50"><Check size={16} /></button>
                      <button onClick={() => { setEditId(null); setEditName(""); }} className="p-1.5 rounded-md text-gray-400 hover:bg-gray-50"><X size={16} /></button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm text-gray-900 font-medium">{b.base_name}</span>
                      <button onClick={() => move(i, -1)} disabled={busy || i === 0} title="Move up" className="p-1 rounded text-gray-400 hover:bg-gray-50 disabled:opacity-30"><ChevronUp size={15} /></button>
                      <button onClick={() => move(i, 1)} disabled={busy || i === bases.length - 1} title="Move down" className="p-1 rounded text-gray-400 hover:bg-gray-50 disabled:opacity-30"><ChevronDown size={15} /></button>
                      <button onClick={() => toggleBase(b)} disabled={busy} title={b.enabled ? "Disable" : "Enable"} className={`text-[11px] px-2 py-1 rounded-md border ${b.enabled ? "border-green-200 text-green-700 bg-green-50" : "border-gray-200 text-gray-500 bg-gray-50"}`}>{b.enabled ? "Enabled" : "Disabled"}</button>
                      <button onClick={() => { setEditId(b.id); setEditName(b.base_name); }} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100"><Pencil size={15} /></button>
                      <button onClick={() => deleteBase(b)} className="p-1.5 rounded-md text-red-500 hover:bg-red-50"><Trash2 size={15} /></button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
              <input value={newBase} onChange={(e) => setNewBase(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addBase()} className={`${inp} flex-1`} placeholder="e.g. President, General Secretary…" />
              <button onClick={addBase} disabled={busy || !newBase.trim()} className="h-10 px-4 rounded-lg text-white text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-60" style={{ background: BRAND }}>
                <Plus size={16} /> Add
              </button>
            </div>
          </div>

          {/* Generated preview per level */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <Wand2 size={15} style={{ color: BRAND }} />
              <h3 className="text-sm font-bold text-gray-900">Auto-generated designations</h3>
              <select value={level} onChange={(e) => setLevel(e.target.value)} className={`${inp} h-8 ml-auto`}>
                {levels.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
            </div>
            <ol className="divide-y divide-gray-100">
              {genLevel.length === 0 ? (
                <li className="px-4 py-6 text-sm text-gray-400">Add base designations to see the generated {levels.find((l) => l.key === level)?.label} designations.</li>
              ) : genLevel.map((g, i) => (
                <li key={g.id} className={`px-4 py-2.5 flex items-center gap-3 text-sm ${g.enabled ? "" : "opacity-50"}`}>
                  <span className="w-6 text-right text-gray-400 font-mono text-xs">{i + 1}</span>
                  <span className="text-gray-900">{g.name}</span>
                  {!g.enabled && <span className="ml-auto text-[11px] text-gray-400">disabled</span>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[140] px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.type === "success" ? <CheckCircle2 size={16} /> : <X size={16} />} {toast.text}
        </div>
      )}
    </div>
  );
}
