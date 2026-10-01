"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Settings as SettingsIcon, Map, Plus, PhoneCall, Users, ChevronRight, ChevronDown, Loader2, Pencil, Trash2, Check, X, Search, GripVertical, ArrowUpDown } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DESIGNATION_LEVELS, designationLevelLabel } from "@/lib/designationLevels";
import { deriveDesignationBase } from "@/lib/designationName";

// The Designation Chain levels (State → Lok Sabha → District → Assembly → Block).
const DESIG_LEVELS = DESIGNATION_LEVELS.filter((l) => l.key !== "zone");
// Wings — label shown to the admin, value is the stored wing name in `designations.wing`.
const DESIG_WINGS = [
  { label: "Main", value: "Main Organisation" },
  { label: "SC", value: "SC Wing" },
  { label: "ST", value: "ST Wing" },
  { label: "Youth", value: "Youth Wing" },
  { label: "Mahila", value: "Mahila Wing" },
  { label: "RTI", value: "RTI Wing" },
  { label: "Legal", value: "Legal Wing" },
  { label: "Transport", value: "Transport Wing" },
  { label: "RWA", value: "RWA Wing" },
  { label: "OBC", value: "OBC Wing" },
  { label: "Social Media", value: "Social Media Wing" },
  { label: "Ex-Employee", value: "Ex-Employee Wing" },
  { label: "ASAP", value: "ASAP Wing" },
  { label: "Minority", value: "Minority Wing" },
  { label: "Labour", value: "Labour Wing" },
  { label: "Trade", value: "Trade Wing" },
];
const DESIG_WING_LABEL = (v) => DESIG_WINGS.find((w) => w.value === v)?.label || v;

// `embedded` hides the standalone page header so this same component can render
// as the "Master Data" tab inside Administration (native tab look) while the
// direct /dashboard/admin/settings route keeps its own header.
export default function MasterDataSettings({ embedded = false }) {
  const [statuses, setStatuses] = useState([]);
  const [newStatus, setNewStatus] = useState("");
  const [statusLoading, setStatusLoading] = useState(false);

  const [designations, setDesignations] = useState([]);

  useEffect(() => {
    fetchStatuses();
    fetchDesignations();
  }, []);

  const fetchDesignations = async () => {
    const res = await fetch("/api/designations");
    if (res.ok) setDesignations((await res.json()).designations || []);
  };

  const fetchStatuses = async () => {
    const res = await fetch("/api/statuses");
    if (res.ok) setStatuses((await res.json()).statuses || []);
  };

  const handleAddStatus = async (e) => {
    e.preventDefault();
    setStatusLoading(true);
    try {
      const res = await fetch("/api/statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newStatus }),
      });
      if (res.ok) { setNewStatus(""); fetchStatuses(); }
    } finally { setStatusLoading(false); }
  };

  return (
    <div className={`space-y-6 animate-in fade-in duration-500 ${embedded ? "" : "max-w-6xl mx-auto"}`}>
      {!embedded && (
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-full bg-[#164FA3] flex items-center justify-center text-white shadow-lg shadow-blue-900/20">
            <SettingsIcon size={24} />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Master Data Settings</h1>
            <p className="text-gray-500 font-medium mt-1">Configure calling statuses, designations, and political geography.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Call Statuses */}
        <ListCard
          icon={PhoneCall}
          title="Call Statuses"
          items={statuses}
          onSubmit={handleAddStatus}
          value={newStatus}
          setValue={setNewStatus}
          loading={statusLoading}
          placeholder="New status name…"
          apiBase="/api/statuses"
          onChanged={fetchStatuses}
        />

        {/* Designations — multi-select Level + Wing. Each selected Level × Wing
            combination is created in the Master, and the configured order is stored
            in sort_order (followed everywhere the app lists designations). */}
        <DesignationsCard designations={designations} onChanged={fetchDesignations} />
      </div>

      {/* Designation Order — per (Level, Wing) manual drag-and-drop ordering. The
          saved order is the single source of truth used everywhere the app lists
          designations (worker lists, search, reports, organisation structure). */}
      <DesignationOrderPanel onChanged={fetchDesignations} />

      {/* Merge duplicate / synonymous designations — full width */}
      <MergeDesignations onChanged={fetchDesignations} />

      {/* Locations — full width */}
      <LocationsTree />

      {/* Assembly-wise Block management (Political Location master) — full width */}
      <AssemblyBlocksPanel />
    </div>
  );
}

// Assembly → Block management inside Political Location (Master Data). Pick an
// Assembly and manage ONLY its Blocks — the Assembly→Block map is the single
// source of truth, stored by ids (block.parent_id → assembly.id). Nothing is
// hardcoded; every Block is loaded from /api/assemblies/{id}/blocks.
function AssemblyBlocksPanel() {
  const [assemblies, setAssemblies] = useState([]);
  const [assemblyId, setAssemblyId] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [nameHi, setNameHi] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    fetch("/api/locations?type=assembly").then((r) => r.json())
      .then((d) => setAssemblies(d.locations || [])).catch(() => {});
  }, []);

  const loadBlocks = async (id) => {
    if (!id) { setBlocks([]); return; }
    setLoading(true); setErr("");
    try {
      const r = await fetch(`/api/assemblies/${id}/blocks`, { cache: "no-store" });
      const d = await r.json();
      setBlocks(d.blocks || []);
    } catch { setErr("Could not load blocks."); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadBlocks(assemblyId); }, [assemblyId]);

  async function addBlock(e) {
    e.preventDefault();
    if (!assemblyId) { setErr("Select an Assembly first."); return; }
    if (!name.trim()) { setErr("Enter a block name."); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await fetch(`/api/assemblies/${assemblyId}/blocks`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, name_hi: nameHi }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d?.message || "Could not add the block."); return; }
      setName(""); setNameHi(""); setMsg("Block added."); loadBlocks(assemblyId);
    } catch { setErr("Could not add the block."); }
    finally { setBusy(false); }
  }

  async function removeBlock(b) {
    if (!confirm(`Delete block "${b.name_en}" from this Assembly?`)) return;
    setErr(""); setMsg("");
    try {
      const r = await fetch(`/api/assemblies/${assemblyId}/blocks/${b.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d?.message || "Could not delete the block."); return; }
      setMsg("Block deleted."); loadBlocks(assemblyId);
    } catch { setErr("Could not delete the block."); }
  }

  async function seed() {
    if (!confirm("Add/verify the standard Assembly → Block mapping? This only creates missing blocks and never duplicates.")) return;
    setSeeding(true); setErr(""); setMsg("");
    try {
      const r = await fetch("/api/master-data/seed-blocks", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d?.message || "Could not seed the mapping."); return; }
      setMsg(`Standard mapping applied — ${d.created} block(s) created, ${d.skippedExisting} already present, ${d.assembliesMatched} assemblies matched${d.assembliesNotFound?.length ? `, not found: ${d.assembliesNotFound.join(", ")}` : ""}.`);
      if (assemblyId) loadBlocks(assemblyId);
    } catch { setErr("Could not seed the mapping."); }
    finally { setSeeding(false); }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-6 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-[#164FA3]">
          <Map size={18} />
          <h2 className="font-bold text-lg">Assembly-wise Blocks</h2>
        </div>
        <button onClick={seed} disabled={seeding}
          className="text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50">
          {seeding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Load standard blocks
        </button>
      </div>

      <div className="p-6 border-b border-gray-100 bg-gray-50">
        <Label>Assembly (Vidhan Sabha)</Label>
        <select value={assemblyId} onChange={(e) => { setAssemblyId(e.target.value); setErr(""); setMsg(""); }}
          className="w-full md:w-96 bg-white border border-gray-200 h-10 rounded-lg px-3 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]">
          <option value="">Select Assembly…</option>
          {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {msg && <div className="mx-6 mt-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</div>}
      {err && <div className="mx-6 mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

      {!assemblyId ? (
        <div className="p-8 text-center text-gray-400 text-sm">Select an Assembly to view and manage its Blocks.</div>
      ) : (
        <div className="p-6 space-y-4">
          {/* Add block */}
          <form onSubmit={addBlock} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <Label>Block Name <span className="text-red-500">*</span></Label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Block name…"
                className="w-full bg-white border border-gray-200 h-10 rounded-lg px-3 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
            </div>
            <div>
              <Label>Block Name (Hindi)</Label>
              <input value={nameHi} onChange={(e) => setNameHi(e.target.value)} placeholder="ब्लॉक का नाम…"
                className="w-full bg-white border border-gray-200 h-10 rounded-lg px-3 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
            </div>
            <button type="submit" disabled={busy}
              className="bg-[#164FA3] text-white h-10 px-4 rounded-lg font-bold hover:bg-blue-800 inline-flex items-center justify-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add Block
            </button>
          </form>

          {loading ? (
            <div className="py-8 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>
          ) : blocks.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">No blocks for this Assembly yet.</div>
          ) : (
            <div className="overflow-x-auto border border-gray-100 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Block</th>
                    <th className="px-4 py-2.5 font-semibold">Hindi Name</th>
                    <th className="px-4 py-2.5 font-semibold">ID</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {blocks.map((b) => (
                    <tr key={b.id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-2.5 font-medium text-gray-900">{b.name_en}</td>
                      <td className="px-4 py-2.5 text-gray-600">{b.name_hi || "—"}</td>
                      <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{b.id}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={() => removeBlock(b)} className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg font-medium inline-flex items-center gap-1">
                          <Trash2 size={14} /> Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Normalize a designation name so spelling/spacing/case/punctuation differences
// collapse to the same key — e.g. "Block  President", "block-president" and
// "Block President." all map to "block president". Used to flag likely dupes.
function normDesignation(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")   // punctuation -> space
    .replace(/\s+/g, " ")        // collapse whitespace
    .trim();
}

// Find, review and merge duplicate or synonymous designations into one row.
function MergeDesignations({ onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fromId, setFromId] = useState("");
  const [intoId, setIntoId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const r = await fetch("/api/designations?stats=1");
    if (r.ok) setItems((await r.json()).designations || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Groups of names that normalize to the same key (likely accidental dupes).
  // NB: this module imports lucide's `Map` icon, which shadows the global Map
  // constructor — so group with a plain object, not `new Map()`.
  const dupeGroups = useMemo(() => {
    const byKey = {};
    for (const d of items) {
      const k = normDesignation(d.name);
      (byKey[k] ||= []).push(d);
    }
    return Object.values(byKey).filter((g) => g.length > 1);
  }, [items]);

  async function merge(from_id, into_id) {
    const from = items.find((d) => d.id === from_id);
    const into = items.find((d) => d.id === into_id);
    if (!from || !into) return;
    if (!confirm(`Merge "${from.name}" into "${into.name}"?\n\nAll ${from.contact_count ?? 0} contact(s) and any calls using "${from.name}" will be moved to "${into.name}", and "${from.name}" will be deleted. This cannot be undone.`)) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const r = await fetch("/api/designations/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_id, into_id }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.message || "Merge failed"); return; }
      setMessage(`Merged "${d.merged_from}" into "${d.merged_into}" — moved ${d.moved_contacts} contact(s) and ${d.moved_calls} call(s).`);
      setFromId(""); setIntoId("");
      await load();
      onChanged?.();
    } catch {
      setError("Merge failed — network error.");
    } finally {
      setBusy(false);
    }
  }

  // Pick the busiest row in a group as the natural merge target.
  function targetOf(group) {
    return [...group].sort((a, b) => (b.contact_count ?? 0) - (a.contact_count ?? 0) || a.id - b.id)[0];
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center"><Users size={18} /></div>
        <h2 className="text-lg font-bold text-gray-900">Merge Designations</h2>
      </div>
      <p className="text-sm text-gray-500 mb-4">Collapse duplicate or same-meaning designations into one. Contacts and calls are repointed to the target; the merged-away name is deleted.</p>

      {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 text-sm mb-4">{message}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm mb-4">{error}</div>}

      {loading ? (
        <div className="text-gray-400 text-sm flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>
      ) : (
        <>
          {/* Auto-detected likely duplicates */}
          <div className="mb-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Likely duplicates (same name, different spelling/case/spacing)</h3>
            {dupeGroups.length === 0 ? (
              <div className="text-sm text-gray-400">None found — no two designations normalize to the same name.</div>
            ) : (
              <ul className="space-y-3">
                {dupeGroups.map((group, gi) => {
                  const target = targetOf(group);
                  return (
                    <li key={gi} className="border border-amber-200 bg-amber-50/50 rounded-xl p-3">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {group.map((d) => (
                          <span key={d.id} className={`text-xs font-medium px-2 py-1 rounded-lg border ${d.id === target.id ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-700 border-gray-200"}`}>
                            {d.name} <span className="opacity-70">· {d.contact_count ?? 0}</span>
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-500">Keep <b>{target.name}</b>, merge the rest in:</span>
                        <button
                          onClick={() => group.filter((d) => d.id !== target.id).reduce(
                            (p, d) => p.then(() => merge(d.id, target.id)), Promise.resolve()
                          )}
                          disabled={busy}
                          className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg"
                        >
                          Merge {group.length - 1} into “{target.name}”
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Manual merge — for synonyms the normalizer can't catch */}
          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Manual merge (for synonyms — different words, same role)</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={fromId} onChange={(e) => setFromId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white min-w-[180px]">
                <option value="">Merge this…</option>
                {items.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.contact_count ?? 0})</option>)}
              </select>
              <ChevronRight size={16} className="text-gray-400" />
              <select value={intoId} onChange={(e) => setIntoId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white min-w-[180px]">
                <option value="">…into this</option>
                {items.filter((d) => String(d.id) !== String(fromId)).map((d) => <option key={d.id} value={d.id}>{d.name} ({d.contact_count ?? 0})</option>)}
              </select>
              <button
                onClick={() => merge(Number(fromId), Number(intoId))}
                disabled={busy || !fromId || !intoId}
                className="text-xs font-semibold bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white px-4 py-2 rounded-lg"
              >
                {busy ? "Merging…" : "Merge"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Designations master — multi-select Level + Wing. The admin picks one or more
// Levels and one or more Wings, types a designation name, and one designation is
// created per Level × Wing combination (unique names, no duplicates), appended to
// that group's configured order (sort_order). Edit can change name / level / wing.
function DesignationsCard({ designations, onChanged }) {
  const [name, setName] = useState("");
  const [levels, setLevels] = useState(() => new Set());
  const [wings, setWings] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editLevel, setEditLevel] = useState("");
  const [editWings, setEditWings] = useState(() => new Set()); // multi-select Wings on edit
  const [addRank, setAddRank] = useState("");   // optional Rank (1-based) for a new designation
  const [editRank, setEditRank] = useState(""); // current Rank of the designation being edited
  const [busy, setBusy] = useState(false);

  const toggle = (setFn, val) => setFn((prev) => { const n = new Set(prev); if (n.has(val)) n.delete(val); else n.add(val); return n; });

  const WING_VALUES = DESIG_WINGS.map((w) => w.value);

  // Rank = the designation's GLOBAL rank, returned by the API as `rank` (the single
  // source of truth for designation order across the whole app). Rows arrive already
  // ordered by rank. A display fallback (1-based list position) covers any legacy row
  // not yet ranked, so the column never shows blank.
  const rankOf = (item, idx) => (item.rank != null ? item.rank : idx + 1);

  // Open the editor for a designation: show its BASE name (level prefix + wing
  // suffix stripped) and pre-select EVERY Wing it is configured for — i.e. all
  // sibling rows that share the same base + level. This is what makes the Wings
  // field multi-select with the current selection already ticked.
  function openEdit(item) {
    const level = item.level || "";
    const base = deriveDesignationBase(item.name, level, WING_VALUES);
    const selected = new Set();
    for (const d of designations) {
      if ((d.level || "") !== level) continue;
      if (deriveDesignationBase(d.name, level, WING_VALUES).toLowerCase() !== base.toLowerCase()) continue;
      if (d.wing) selected.add(d.wing);
    }
    if (item.wing) selected.add(item.wing);
    setEditingId(item.id);
    setEditName(base);
    setEditLevel(level);
    setEditWings(selected);
    setEditRank(item.rank != null ? String(item.rank) : "");
    setError("");
  }

  async function add(e) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Please enter a Designation name."); return; }
    if (levels.size === 0) { setError("Please select at least one Level."); return; }
    const rk = parseInt(addRank, 10);
    if (!Number.isInteger(rk) || rk < 1) { setError("Please enter a Rank (a whole number ≥ 1)."); return; }
    setLoading(true);
    try {
      const r = await fetch("/api/designations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), levels: [...levels], wings: [...wings] }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError([d.message || "Failed to add designation.", d.detail].filter(Boolean).join(" — ")); return; }
      // Place each newly-created row at the chosen global Rank (rk is validated above
      // and required). When several rows are created at once (multiple Levels/Wings)
      // they land consecutively from rk, keeping their order.
      if (Array.isArray(d.created)) {
        for (let i = 0; i < d.created.length; i++) {
          // eslint-disable-next-line no-await-in-loop
          await fetch("/api/designations/rank", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: d.created[i].id, rank: rk + i }),
          });
        }
      }
      setName(""); setLevels(new Set()); setWings(new Set()); setAddRank(""); onChanged();
    } finally { setLoading(false); }
  }

  async function saveEdit(id) {
    if (!editName.trim()) return;
    if (!editLevel) { setError("Please select a Level."); return; }
    setBusy(true); setError("");
    // The Wings endpoint syncs the sibling rows (one per selected Wing) for this
    // base + level: it creates missing Wings and removes deselected ones that have
    // no assignments. It is the single save for name + level + the full Wing set.
    const r = await fetch(`/api/designations/${id}/wings`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), level: editLevel, wings: [...editWings] }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      // Apply the Rank (position in this designation's own Level+Wing group). The
      // edited row keeps its id (renamed in place), so repositioning it is safe; if
      // its own wing was removed the call simply no-ops.
      const rk = parseInt(editRank, 10);
      if (Number.isInteger(rk) && rk >= 1) {
        await fetch("/api/designations/rank", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, rank: rk }),
        }).catch(() => {});
      }
      setEditingId(null);
      onChanged();
      if (d.keptAssigned && d.keptAssigned.length) setError(d.message || "");
    } else setError([d.message || "Update failed", d.detail].filter(Boolean).join(" — "));
    setBusy(false);
  }

  async function remove(item) {
    if (!confirm(`Delete "${item.name}"? Records using it keep their data but show no designation.`)) return;
    setBusy(true); setError("");
    const r = await fetch(`/api/designations/${item.id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) onChanged(); else setError(d.message || "Delete failed");
    setBusy(false);
  }

  const pill = (active) => `text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${active ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-[500px]">
      <div className="p-6 border-b border-gray-100 flex items-center gap-2 text-[#164FA3]">
        <Users size={18} />
        <h2 className="font-bold text-lg">Designations</h2>
      </div>
      <div className="p-5 border-b border-gray-100 bg-gray-50">
        <form onSubmit={add} className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Level <span className="text-red-500">*</span> <span className="text-gray-400 normal-case font-normal">(select one or more)</span></label>
            <div className="flex flex-wrap gap-1.5">
              {DESIG_LEVELS.map((l) => (
                <button type="button" key={l.key} onClick={() => toggle(setLevels, l.key)} className={pill(levels.has(l.key))}>{l.label}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Wing <span className="text-gray-400 normal-case font-normal">(optional — one or more)</span></label>
            <div className="flex flex-wrap gap-1.5">
              {DESIG_WINGS.map((w) => (
                <button type="button" key={w.value} onClick={() => toggle(setWings, w.value)} className={pill(wings.has(w.value))}>{w.label}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Designation name…"
              className="flex-1 bg-white border border-gray-200 text-gray-900 h-10 rounded-lg px-4 text-sm focus:ring-2 focus:ring-[#164FA3] outline-none" />
            <input type="number" min="1" step="1" required value={addRank} onChange={(e) => setAddRank(e.target.value)} placeholder="Rank *" title="Rank — required. The designation's global position (1 = first). Others re-sequence to keep a clean 1..N order."
              className="w-24 bg-white border border-gray-200 text-gray-900 h-10 rounded-lg px-3 text-sm focus:ring-2 focus:ring-[#164FA3] outline-none" />
            <button type="submit" disabled={loading} className="bg-[#FCB712] text-[#164FA3] px-4 rounded-lg font-bold hover:bg-yellow-500 transition-colors flex items-center gap-2 disabled:opacity-50">
              <Plus size={16} /> Add
            </button>
          </div>
        </form>
        {error && <div className="mt-3 bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-xs">{error}</div>}
      </div>
      <div className="flex-1 overflow-auto p-2">
        <ul className="divide-y divide-gray-100">
          {designations.map((s, sIdx) => (
            <li key={s.id} className={`p-3.5 hover:bg-gray-50 rounded-lg ${editingId === s.id ? "flex flex-col gap-2.5" : "flex items-center justify-between gap-2"}`}>
              {editingId === s.id ? (
                <>
                  <div className="flex items-center gap-2">
                    <input value={editName} onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(s.id); if (e.key === "Escape") setEditingId(null); }} autoFocus
                      placeholder="Designation name…"
                      className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
                    <select value={editLevel} onChange={(e) => setEditLevel(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white outline-none">
                      <option value="">— level —</option>
                      {DESIG_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                    </select>
                    <input type="number" min="1" step="1" value={editRank} onChange={(e) => setEditRank(e.target.value)} title="Global Rank — change to move this designation; others re-sequence automatically"
                      className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white outline-none focus:ring-2 focus:ring-[#164FA3]" placeholder="Rank" />
                    <button onClick={() => saveEdit(s.id)} disabled={busy} title="Save" className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg disabled:opacity-50"><Check size={16} /></button>
                    <button onClick={() => setEditingId(null)} title="Cancel" className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Wings <span className="text-gray-400 normal-case font-normal">(select one or more — add/remove)</span></div>
                    <div className="flex flex-wrap gap-1.5">
                      {DESIG_WINGS.map((w) => (
                        <button type="button" key={w.value} onClick={() => toggle(setEditWings, w.value)} className={pill(editWings.has(w.value))}>{w.label}</button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <span title="Global designation Rank" className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-full bg-gray-100 text-gray-600 text-xs font-bold">{rankOf(s, sIdx)}</span>
                  <span className="font-medium text-gray-700 flex-1 min-w-0 truncate">{s.name}</span>
                  {s.level
                    ? <span className="text-[10px] uppercase font-bold tracking-wide text-[#164FA3] bg-[#164FA3]/10 px-2 py-1 rounded-full whitespace-nowrap">{designationLevelLabel(s.level) || s.level}</span>
                    : <span className="text-[10px] uppercase font-bold tracking-wide text-amber-700 bg-amber-100 px-2 py-1 rounded-full">No level</span>}
                  {s.wing && <span className="text-[10px] uppercase font-bold tracking-wide text-purple-700 bg-purple-100 px-2 py-1 rounded-full whitespace-nowrap">{DESIG_WING_LABEL(s.wing)}</span>}
                  <button onClick={() => openEdit(s)} title="Edit (name, level & wings)" className="p-1.5 text-gray-400 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg"><Pencil size={14} /></button>
                  <button onClick={() => remove(s)} disabled={busy} title="Delete" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"><Trash2 size={14} /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// One draggable designation row (dnd-kit sortable). The drag handle is explicit so
// the Delete button stays clickable and the row is keyboard-reorderable.
function SortableDesignationRow({ item, index, count, onDelete, onMove, busy, dim }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : dim ? 0.4 : 1 };
  // Rank = the GLOBAL 1-based position. Editable: typing a new Rank moves the row
  // there (same as dragging), then "Save Rank Order" persists it. Also drag.
  const commit = (e) => {
    const v = parseInt(e.target.value, 10);
    if (Number.isInteger(v) && v >= 1 && v - 1 !== index) onMove(index, v - 1);
  };
  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2.5 shadow-sm">
      <button type="button" {...attributes} {...listeners} title="Drag to reorder" className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 touch-none shrink-0">
        <GripVertical size={16} />
      </button>
      <input type="number" min="1" max={count} step="1" defaultValue={index + 1} key={`${item.id}:${index}`}
        onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        title="Rank — type a position to move this designation"
        className="w-12 text-center text-xs font-bold text-gray-600 border border-gray-200 rounded-md py-1 outline-none focus:ring-2 focus:ring-[#164FA3] shrink-0" />
      <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-700">{item.name}</span>
      {item.level && <span className="hidden sm:inline text-[10px] uppercase font-bold tracking-wide text-[#164FA3] bg-[#164FA3]/10 px-2 py-1 rounded-full whitespace-nowrap shrink-0">{designationLevelLabel(item.level) || item.level}</span>}
      {item.wing && <span className="hidden md:inline text-[10px] uppercase font-bold tracking-wide text-purple-700 bg-purple-100 px-2 py-1 rounded-full whitespace-nowrap shrink-0">{DESIG_WING_LABEL(item.wing)}</span>}
      <button type="button" onClick={() => onDelete(item)} disabled={busy} title="Delete" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50 shrink-0"><Trash2 size={14} /></button>
    </li>
  );
}

// Designation Order — manual per-(Level, Wing) ordering with drag-and-drop. The
// admin picks ONE Level + Wing (each combination is ordered independently), drags
// the designations into the desired sequence and saves. The saved order
// (designations.sort_order, flagged manual_order=1) becomes the single source of
// truth read everywhere the app lists designations — no alphabetical/auto sorting.
function DesignationOrderPanel({ onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const load = useCallback(async () => {
    setLoading(true); setErr(""); setMsg("");
    try {
      const r = await fetch("/api/designations");
      const d = await r.json().catch(() => ({}));
      // /api/designations returns ALL designations already in global Rank order.
      setItems(d.designations || []);
      setDirty(false);
    } catch {
      setErr("Could not load designations.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Dragging/typing only reorders the FULL list (never a filtered subset), so the
  // global 1..N rank saved is always complete and unambiguous.
  function onDragEnd(e) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIndex = prev.findIndex((x) => x.id === active.id);
      const newIndex = prev.findIndex((x) => x.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
    setDirty(true); setMsg("");
  }

  function moveToIndex(fromIndex, toIndex) {
    setItems((prev) => {
      const to = Math.min(Math.max(toIndex, 0), prev.length - 1);
      if (fromIndex === to || fromIndex < 0) return prev;
      return arrayMove(prev, fromIndex, to);
    });
    setDirty(true); setMsg("");
  }

  async function save() {
    setSaving(true); setErr(""); setMsg("");
    try {
      const r = await fetch("/api/designations/rank", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: items.map((x) => x.id) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr([d.message || "Failed to save order.", d.detail].filter(Boolean).join(" — ")); return; }
      setDirty(false);
      setMsg("Rank saved. This order now applies everywhere designations are shown.");
      await load();
      onChanged?.();
    } finally { setSaving(false); }
  }

  async function onDelete(item) {
    if (!confirm(`Delete "${item.name}"? Records using it keep their data but show no designation.`)) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await fetch(`/api/designations/${item.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || "Delete failed"); return; }
      await load();
      onChanged?.();
    } finally { setBusy(false); }
  }

  const needle = q.trim().toLowerCase();
  // A search only DIMS non-matches (matches are highlighted) — the list order and the
  // draggable set stay the FULL list so a save always writes a complete global rank.
  const matches = (it) => !needle || String(it.name || "").toLowerCase().includes(needle);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-6 border-b border-gray-100 flex items-start gap-2 text-[#164FA3]">
        <ArrowUpDown size={18} className="mt-0.5 shrink-0" />
        <div>
          <h2 className="font-bold text-lg">Designation Rank Order</h2>
          <p className="text-xs text-gray-500 font-normal mt-0.5">Drag, or type a Rank number, to set the GLOBAL designation order (1, 2, 3 …). This single order is used everywhere designations appear — Contacts, Incomplete, worker lists, dropdowns, filters, search, vacancies, reports and the organisation structure. No alphabetical or automatic sorting is applied.</p>
        </div>
      </div>
      <div className="p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a designation…"
              className="w-full pl-9 h-10 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
          </div>
          <button type="button" onClick={save} disabled={saving || !dirty} className="bg-[#FCB712] text-[#164FA3] px-4 py-2 rounded-lg font-bold hover:bg-yellow-500 transition-colors flex items-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save Rank Order
          </button>
        </div>

        {err && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-xs">{err}</div>}
        {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-2 text-xs">{msg}</div>}
        {dirty && <div className="text-xs text-amber-700 font-medium">Unsaved order — click “Save Rank Order” to persist it.</div>}

        {loading ? (
          <div className="py-10 text-center text-gray-400"><Loader2 className="animate-spin inline" size={20} /></div>
        ) : items.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No designations yet. Create them in the Designations panel above.</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((x) => x.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2 max-h-[460px] overflow-auto pr-1">
                {items.map((item, idx) => (
                  <SortableDesignationRow key={item.id} item={item} index={idx} count={items.length} onMove={moveToIndex} onDelete={onDelete} busy={busy} dim={!matches(item)} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

function ListCard({ icon: Icon, title, items, onSubmit, value, setValue, loading, placeholder, apiBase, onChanged, levelOptions, level, setLevel, addError }) {
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editLevel, setEditLevel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function saveEdit(id) {
    if (!editName.trim()) return;
    setBusy(true); setError("");
    const r = await fetch(`${apiBase}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), ...(levelOptions ? { level: editLevel } : {}) }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setEditingId(null); onChanged(); }
    else setError(d.message || "Update failed");
    setBusy(false);
  }

  async function remove(item) {
    if (!confirm(`Delete "${item.name}"? Records using it will show no ${title.toLowerCase().replace(/s$/, "")}.`)) return;
    setBusy(true); setError("");
    const r = await fetch(`${apiBase}/${item.id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) onChanged();
    else setError(d.message || "Delete failed");
    setBusy(false);
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-[500px]">
      <div className="p-6 border-b border-gray-100 flex items-center gap-2 text-[#164FA3]">
        <Icon size={18} />
        <h2 className="font-bold text-lg">{title}</h2>
      </div>
      <div className="p-6 border-b border-gray-100 bg-gray-50">
        <form onSubmit={onSubmit} className="space-y-3">
          {levelOptions && (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Level <span className="text-red-500">*</span></label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                required
                className="w-full bg-white border border-gray-200 text-gray-900 h-10 rounded-lg px-3 text-sm focus:ring-2 focus:ring-[#164FA3] outline-none"
              >
                <option value="">Select level…</option>
                {levelOptions.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-3">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              placeholder={placeholder}
              className="flex-1 bg-white border border-gray-200 text-gray-900 h-10 rounded-lg px-4 text-sm focus:ring-2 focus:ring-[#164FA3] outline-none"
            />
            <button type="submit" disabled={loading} className="bg-[#FCB712] text-[#164FA3] px-4 rounded-lg font-bold hover:bg-yellow-500 transition-colors flex items-center gap-2 disabled:opacity-50">
              <Plus size={16} /> Add
            </button>
          </div>
        </form>
        {(addError || error) && <div className="mt-3 bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-xs">{addError || error}</div>}
      </div>
      <div className="flex-1 overflow-auto p-2">
        <ul className="divide-y divide-gray-100">
          {items.map((s) => (
            <li key={s.id} className="p-4 hover:bg-gray-50 flex items-center justify-between gap-2 rounded-lg">
              {editingId === s.id ? (
                <>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveEdit(s.id); if (e.key === "Escape") setEditingId(null); }}
                    autoFocus
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]"
                  />
                  {levelOptions && (
                    <select
                      value={editLevel}
                      onChange={(e) => setEditLevel(e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white outline-none focus:ring-2 focus:ring-[#164FA3]"
                    >
                      <option value="">— level —</option>
                      {levelOptions.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                    </select>
                  )}
                  <button onClick={() => saveEdit(s.id)} disabled={busy} title="Save" className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg disabled:opacity-50"><Check size={16} /></button>
                  <button onClick={() => setEditingId(null)} title="Cancel" className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
                </>
              ) : (
                <>
                  <span className="font-medium text-gray-700 flex-1">{s.name}</span>
                  {levelOptions && (
                    s.level
                      ? <span className="text-[10px] uppercase font-bold tracking-wide text-[#164FA3] bg-[#164FA3]/10 px-2 py-1 rounded-full">{designationLevelLabel(s.level) || s.level}</span>
                      : <span className="text-[10px] uppercase font-bold tracking-wide text-amber-700 bg-amber-100 px-2 py-1 rounded-full">No level</span>
                  )}
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">ID: {s.id}</span>
                  <button onClick={() => { setEditingId(s.id); setEditName(s.name); setEditLevel(s.level || ""); setError(""); }} title="Edit" className="p-1.5 text-gray-400 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg"><Pencil size={14} /></button>
                  <button onClick={() => remove(s)} disabled={busy} title="Delete" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"><Trash2 size={14} /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Lazy-loading tree view. Top level: zones. Click to expand → fetch children. Repeats down to VS.
function LocationsTree() {
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ zone: 0, lok_sabha: 0, district: 0, assembly: 0 });

  // New-location form state
  const [newLocation, setNewLocation] = useState({ type: "zone", name: "", parent_id: "" });
  const [allLocations, setAllLocations] = useState([]); // for parent dropdown + search
  const [adding, setAdding] = useState(false);

  // Search across the whole political-geography master data (all levels)
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const byId = useMemo(() => {
    const m = {};
    allLocations.forEach((l) => { m[l.id] = l; });
    return m;
  }, [allLocations]);
  const pathOf = (node) => {
    const parts = [];
    let p = byId[node.parent_id];
    let guard = 0;
    while (p && guard++ < 10) { parts.unshift(p.name); p = byId[p.parent_id]; }
    return parts.join(" → ");
  };
  const results = useMemo(() => {
    if (!q) return null;
    return allLocations
      .filter((l) => l.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 300);
  }, [q, allLocations]);

  useEffect(() => {
    refresh();
  }, []);

  const [treeVersion, setTreeVersion] = useState(0);
  const refresh = async () => {
    setLoading(true);
    setTreeVersion((v) => v + 1); // remount the tree so expanded branches reload fresh data
    const [zonesRes, allRes] = await Promise.all([
      fetch("/api/locations?type=zone").then((r) => r.json()),
      fetch("/api/locations?all=1").then((r) => r.json()),
    ]);
    setZones(zonesRes.locations || []);
    const all = allRes.locations || [];
    setAllLocations(all);
    setCounts({
      zone:      all.filter((l) => l.type === "zone").length,
      lok_sabha: all.filter((l) => l.type === "lok_sabha").length,
      district:  all.filter((l) => l.type === "district").length,
      assembly:  all.filter((l) => l.type === "assembly").length,
    });
    setLoading(false);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setAdding(true);
    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newLocation),
      });
      if (res.ok) {
        setNewLocation({ ...newLocation, name: "" });
        refresh();
      }
    } finally { setAdding(false); }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-6 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[#164FA3]">
          <Map size={18} />
          <h2 className="font-bold text-lg">Political Locations</h2>
        </div>
        <div className="flex gap-4 text-xs">
          <Stat label="Zones"        value={counts.zone} />
          <Stat label="Lok Sabhas"   value={counts.lok_sabha} />
          <Stat label="Districts"    value={counts.district} />
          <Stat label="Vidhan Sabhas" value={counts.assembly} />
        </div>
      </div>

      {/* Add form */}
      <div className="p-6 border-b border-gray-100 bg-gray-50">
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <Label>Type</Label>
            <select
              value={newLocation.type}
              onChange={(e) => setNewLocation({ ...newLocation, type: e.target.value, parent_id: "" })}
              className="w-full bg-white border border-gray-200 h-10 rounded-lg px-3 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]"
            >
              <option value="zone">Zone</option>
              <option value="lok_sabha">Lok Sabha</option>
              <option value="district">District</option>
              <option value="assembly">Vidhan Sabha</option>
              <option value="ward">Block</option>
              <option value="booth">Polling Station</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <Label>Parent</Label>
            <select
              value={newLocation.parent_id}
              onChange={(e) => setNewLocation({ ...newLocation, parent_id: e.target.value })}
              disabled={newLocation.type === "zone"}
              className="w-full bg-white border border-gray-200 h-10 rounded-lg px-3 text-sm outline-none focus:ring-2 focus:ring-[#164FA3] disabled:opacity-50"
            >
              <option value="">{newLocation.type === "zone" ? "— root —" : "Select parent…"}</option>
              {allLocations
                .filter((l) => isValidParent(newLocation.type, l.type))
                .map((l) => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
            </select>
          </div>
          <div className="md:col-span-1">
            <Label>Name</Label>
            <div className="flex gap-2">
              <input
                value={newLocation.name}
                onChange={(e) => setNewLocation({ ...newLocation, name: e.target.value })}
                required
                placeholder="Location name…"
                className="flex-1 bg-white border border-gray-200 h-10 rounded-lg px-3 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]"
              />
              <button type="submit" disabled={adding} className="bg-[#164FA3] text-white px-3 rounded-lg font-bold hover:bg-blue-800 transition-colors flex items-center gap-1 disabled:opacity-50">
                <Plus size={16} />
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Search */}
      <div className="px-6 pt-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search any location — zone, Lok Sabha, district, Vidhan Sabha, block…"
            className="w-full bg-white border border-gray-200 h-10 rounded-lg pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              title="Clear"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Tree, or flat search results */}
      <div className="p-4 max-h-[600px] overflow-auto">
        {loading ? (
          <div className="py-8 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>
        ) : results !== null ? (
          results.length === 0 ? (
            <div className="py-8 text-center text-gray-400">No locations match “{search.trim()}”.</div>
          ) : (
            <>
              <div className="px-2 pb-2 text-xs text-gray-400">
                {results.length}{results.length === 300 ? "+" : ""} match{results.length === 1 ? "" : "es"}
              </div>
              <ul className="divide-y divide-gray-100">
                {results.map((l) => {
                  const path = pathOf(l);
                  return (
                    <li key={l.id} className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-blue-50">
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full shrink-0 ${TYPE_COLOR[l.type]}`}>
                        {TYPE_LABEL[l.type]}
                      </span>
                      <span className="font-medium text-gray-800 shrink-0">{l.name}</span>
                      {path && <span className="text-xs text-gray-400 truncate">in {path}</span>}
                      <span className="ml-auto text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded shrink-0">ID: {l.id}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )
        ) : zones.length === 0 ? (
          <div className="py-8 text-center text-gray-400">No locations yet. Add a zone above.</div>
        ) : (
          <ul key={treeVersion}>
            {zones.map((z) => <TreeNode key={z.id} node={z} depth={0} onChanged={refresh} />)}
          </ul>
        )}
      </div>
    </div>
  );
}

const CHILD_TYPE = {
  zone: "lok_sabha",
  lok_sabha: "district",
  district: "assembly",
  assembly: "ward",
  ward: "booth",
};

// DB type keys stay 'ward'/'booth' — only the display labels changed.
const TYPE_LABEL = {
  zone: "Zone",
  lok_sabha: "Lok Sabha",
  district: "District",
  assembly: "Vidhan Sabha",
  ward: "Block",
  booth: "Polling Station",
};

const TYPE_COLOR = {
  zone:      "bg-[#164FA3] text-white",
  lok_sabha: "bg-blue-100 text-blue-800",
  district:  "bg-emerald-100 text-emerald-800",
  assembly:  "bg-amber-100 text-amber-800",
  ward:      "bg-purple-100 text-purple-800",
  booth:     "bg-pink-100 text-pink-800",
};

function isValidParent(childType, parentType) {
  const allowed = {
    lok_sabha: "zone",
    district:  "lok_sabha",
    assembly:  "district",
    ward:      "assembly",
    booth:     "ward",
  };
  return allowed[childType] === parentType;
}

const PARENT_TYPE = {
  lok_sabha: "zone",
  district: "lok_sabha",
  assembly: "district",
  ward: "assembly",
  booth: "ward",
};

function TreeNode({ node, depth, onChanged }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const [editParent, setEditParent] = useState(node.parent_id || "");
  const [parentOptions, setParentOptions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const childType = CHILD_TYPE[node.type];
  const parentType = PARENT_TYPE[node.type];

  const toggle = async () => {
    if (editing) return;
    if (!childType) return; // leaf
    if (expanded) { setExpanded(false); return; }
    if (children == null) {
      setLoading(true);
      const r = await fetch(`/api/locations?parent_id=${node.id}`);
      if (r.ok) setChildren((await r.json()).locations || []);
      setLoading(false);
    }
    setExpanded(true);
  };

  async function openEdit(e) {
    e.stopPropagation();
    setEditName(node.name);
    setEditParent(node.parent_id || "");
    setError("");
    if (parentType) {
      const r = await fetch(`/api/locations?type=${parentType}`);
      if (r.ok) setParentOptions((await r.json()).locations || []);
    }
    setEditing(true);
  }

  async function saveEdit(e) {
    e.stopPropagation();
    setBusy(true); setError("");
    const r = await fetch(`/api/locations/${node.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, ...(parentType ? { parent_id: editParent || null } : {}) }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { setEditing(false); onChanged(); }
    else setError(d.message || "Update failed");
  }

  async function del(e) {
    e.stopPropagation();
    if (!confirm(`Delete "${node.name}"?`)) return;
    setBusy(true); setError("");
    const r = await fetch(`/api/locations/${node.id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) onChanged();
    else setError(d.message || "Delete failed");
  }

  return (
    <li>
      <div
        onClick={toggle}
        className={`group flex items-center gap-2 py-2 px-2 rounded-lg cursor-pointer hover:bg-blue-50 ${childType ? "" : "cursor-default hover:bg-gray-50"}`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {childType ? (
          expanded ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full shrink-0 ${TYPE_COLOR[node.type]}`}>
          {TYPE_LABEL[node.type]}
        </span>
        {!editing ? (
          <>
            <span className="font-medium text-gray-800">{node.name}</span>
            <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={openEdit} title={parentType ? "Rename / move to another parent" : "Rename"} className="p-1.5 text-gray-400 hover:text-[#164FA3] hover:bg-blue-100 rounded-lg"><Pencil size={13} /></button>
              <button onClick={del} disabled={busy} title="Delete" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"><Trash2 size={13} /></button>
            </span>
            {loading && <Loader2 size={14} className="animate-spin text-gray-400" />}
          </>
        ) : (
          <span className="flex items-center gap-2 flex-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus className="border border-gray-300 rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
            {parentType && (
              <select value={editParent} onChange={(e) => setEditParent(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-sm bg-white">
                <option value="">— {TYPE_LABEL[parentType]} —</option>
                {parentOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <button onClick={saveEdit} disabled={busy || !editName.trim()} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg disabled:opacity-50"><Check size={15} /></button>
            <button onClick={(e) => { e.stopPropagation(); setEditing(false); }} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X size={15} /></button>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </span>
        )}
      </div>
      {!editing && error && (
        <div className="text-xs text-red-600" style={{ paddingLeft: `${depth * 20 + 32}px` }}>{error}</div>
      )}
      {expanded && children && children.length > 0 && (
        <ul>{children.map((c) => <TreeNode key={c.id} node={c} depth={depth + 1} onChanged={onChanged} />)}</ul>
      )}
      {expanded && children && children.length === 0 && (
        <div className="text-xs text-gray-400 italic" style={{ paddingLeft: `${(depth + 1) * 20 + 8}px` }}>
          No {TYPE_LABEL[childType]?.toLowerCase()}s.
        </div>
      )}
    </li>
  );
}

function Label({ children }) {
  return <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{children}</label>;
}

function Stat({ label, value }) {
  return (
    <div className="text-center">
      <div className="font-bold text-gray-900 text-base leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mt-0.5">{label}</div>
    </div>
  );
}
