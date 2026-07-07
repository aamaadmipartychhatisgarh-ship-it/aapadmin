"use client";

import { useState, useEffect } from "react";
import { Settings as SettingsIcon, Map, Plus, PhoneCall, Users, ChevronRight, ChevronDown, Loader2, Pencil, Trash2, Check, X } from "lucide-react";

export default function MasterDataSettings() {
  const [statuses, setStatuses] = useState([]);
  const [newStatus, setNewStatus] = useState("");
  const [statusLoading, setStatusLoading] = useState(false);

  const [designations, setDesignations] = useState([]);
  const [newDesignation, setNewDesignation] = useState("");
  const [desigLoading, setDesigLoading] = useState(false);

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

  const handleAddDesignation = async (e) => {
    e.preventDefault();
    setDesigLoading(true);
    try {
      const res = await fetch("/api/designations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newDesignation }),
      });
      if (res.ok) { setNewDesignation(""); fetchDesignations(); }
    } finally { setDesigLoading(false); }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-6xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-full bg-[#164FA3] flex items-center justify-center text-white shadow-lg shadow-blue-900/20">
          <SettingsIcon size={24} />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Master Data Settings</h1>
          <p className="text-gray-500 font-medium mt-1">Configure calling statuses, designations, and political geography.</p>
        </div>
      </div>

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

        {/* Designations */}
        <ListCard
          icon={Users}
          title="Designations"
          items={designations}
          onSubmit={handleAddDesignation}
          value={newDesignation}
          setValue={setNewDesignation}
          loading={desigLoading}
          placeholder="New designation name…"
          apiBase="/api/designations"
          onChanged={fetchDesignations}
        />
      </div>

      {/* Locations — full width */}
      <LocationsTree />
    </div>
  );
}

function ListCard({ icon: Icon, title, items, onSubmit, value, setValue, loading, placeholder, apiBase, onChanged }) {
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function saveEdit(id) {
    if (!editName.trim()) return;
    setBusy(true); setError("");
    const r = await fetch(`${apiBase}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
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
        <form onSubmit={onSubmit} className="flex gap-3">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            placeholder={placeholder}
            className="flex-1 bg-white border border-gray-200 text-gray-900 h-10 rounded-lg px-4 text-sm focus:ring-2 focus:ring-[#164FA3] outline-none"
          />
          <button type="submit" disabled={loading} className="bg-[#FCB712] text-[#164FA3] px-4 rounded-lg font-bold hover:bg-yellow-500 transition-colors flex items-center gap-2">
            <Plus size={16} /> Add
          </button>
        </form>
        {error && <div className="mt-3 bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-xs">{error}</div>}
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
                  <button onClick={() => saveEdit(s.id)} disabled={busy} title="Save" className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg disabled:opacity-50"><Check size={16} /></button>
                  <button onClick={() => setEditingId(null)} title="Cancel" className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
                </>
              ) : (
                <>
                  <span className="font-medium text-gray-700 flex-1">{s.name}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">ID: {s.id}</span>
                  <button onClick={() => { setEditingId(s.id); setEditName(s.name); setError(""); }} title="Edit" className="p-1.5 text-gray-400 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg"><Pencil size={14} /></button>
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
  const [allLocations, setAllLocations] = useState([]); // for parent dropdown
  const [adding, setAdding] = useState(false);

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

      {/* Tree */}
      <div className="p-4 max-h-[600px] overflow-auto">
        {loading ? (
          <div className="py-8 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>
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
