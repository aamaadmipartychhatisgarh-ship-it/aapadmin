"use client";

import { useState } from "react";
import { X, Search } from "lucide-react";

// PROMPT 5 — a form multi-select for a contact's designations. Unlike the filter
// MultiSelect (where empty = "all"), here empty genuinely means NO designation
// (no default is ever assigned). `value` is an array of ids; onChange gets the
// next array. Selected designations show as removable tags; the checkbox list is
// searchable. One or many can be selected.
export default function DesignationMultiSelect({ options = [], value = [], onChange, placeholder = "Select designation(s)" }) {
  const [q, setQ] = useState("");
  const sel = (value || []).map(String);
  const toggle = (id) => {
    const k = String(id);
    onChange(sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k]);
  };
  const remove = (id) => onChange(sel.filter((x) => x !== String(id)));
  const filtered = q ? options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase())) : options;
  const byId = new Map(options.map((o) => [String(o.id), o]));

  return (
    <div className="border border-gray-200 rounded-lg p-2 space-y-2 bg-white">
      {/* Selected tags */}
      {sel.length === 0 ? (
        <div className="text-xs text-gray-400 px-1">{placeholder}</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {sel.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 bg-blue-50 text-[#164FA3] border border-blue-100 rounded-full pl-2.5 pr-1 py-0.5 text-xs font-semibold">
              {byId.get(id)?.name || `#${id}`}
              <button type="button" onClick={() => remove(id)} className="hover:bg-blue-100 rounded-full p-0.5" aria-label="Remove"><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      {/* Search + checkbox list */}
      <div className="relative">
        <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search designations…"
          className="w-full pl-7 pr-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[#164FA3]/30" />
      </div>
      <div className="max-h-40 overflow-auto border border-gray-100 rounded-lg">
        {filtered.length === 0 ? (
          <div className="text-xs text-gray-400 px-3 py-2">No designations found.</div>
        ) : filtered.map((o) => {
          const on = sel.includes(String(o.id));
          return (
            <label key={o.id} className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${on ? "bg-blue-50 text-[#164FA3] font-medium" : "text-gray-700 hover:bg-gray-50"}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(o.id)} className="accent-[#164FA3]" />
              <span className="truncate">{o.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// Parse the API's designation_ids (CSV string, array, or null) into a clean
// array of id strings for the form state.
export function parseDesignationIdList(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  return String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
