"use client";

import { useState, useEffect } from "react";
import { Settings as SettingsIcon, Map, Plus, PhoneCall, Users, ChevronRight, ChevronDown, Loader2 } from "lucide-react";

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
        />
      </div>

      {/* Locations — full width */}
      <LocationsTree />
    </div>
  );
}

function ListCard({ icon: Icon, title, items, onSubmit, value, setValue, loading, placeholder }) {
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
      </div>
      <div className="flex-1 overflow-auto p-2">
        <ul className="divide-y divide-gray-100">
          {items.map((s) => (
            <li key={s.id} className="p-4 hover:bg-gray-50 flex items-center justify-between rounded-lg">
              <span className="font-medium text-gray-700">{s.name}</span>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">ID: {s.id}</span>
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

  const refresh = async () => {
    setLoading(true);
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
              <option value="ward">Ward</option>
              <option value="booth">Booth</option>
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
          <ul>
            {zones.map((z) => <TreeNode key={z.id} node={z} depth={0} />)}
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

const TYPE_LABEL = {
  zone: "Zone",
  lok_sabha: "Lok Sabha",
  district: "District",
  assembly: "Vidhan Sabha",
  ward: "Ward",
  booth: "Booth",
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

function TreeNode({ node, depth }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);
  const childType = CHILD_TYPE[node.type];

  const toggle = async () => {
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

  return (
    <li>
      <div
        onClick={toggle}
        className={`flex items-center gap-2 py-2 px-2 rounded-lg cursor-pointer hover:bg-blue-50 ${childType ? "" : "cursor-default hover:bg-gray-50"}`}
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
        <span className="font-medium text-gray-800">{node.name}</span>
        {children && (
          <span className="ml-auto text-xs text-gray-400">{children.length} {TYPE_LABEL[childType]?.toLowerCase()}{children.length === 1 ? "" : "s"}</span>
        )}
        {loading && <Loader2 size={14} className="animate-spin text-gray-400 ml-auto" />}
      </div>
      {expanded && children && children.length > 0 && (
        <ul>{children.map((c) => <TreeNode key={c.id} node={c} depth={depth + 1} />)}</ul>
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
