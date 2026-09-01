"use client";

import { useRef, useState } from "react";
import FloatingPopover from "@/components/FloatingPopover";

// A compact "Columns" dropdown for choosing which columns an export includes.
// Shows a checkbox per exportable column (all selected by default). The last
// remaining column can't be unchecked (an export needs at least one column).
// Shared by Contacts, MLA Profile and AAP Candidate so column selection behaves
// identically everywhere.
//   columns  — [{ key, label }] in canonical order
//   selected — array of selected keys
//   onChange — (nextSelectedKeys) => void
export default function ColumnPicker({ columns, selected, onChange, label = "Columns" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const allKeys = columns.map((c) => c.key);
  const count = selected.length;
  const total = columns.length;

  const toggle = (key) => {
    const has = selected.includes(key);
    if (has && count <= 1) return; // never leave zero columns
    onChange(has ? selected.filter((k) => k !== key) : [...selected, key]);
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-semibold bg-white hover:bg-gray-50 ${count < total ? "border-[#164FA3] text-[#164FA3]" : "border-gray-200 text-gray-700"}`}
        title="Choose which columns to export"
      >
        {label}{count < total ? ` (${count}/${total})` : ""}
        <span className="text-gray-400">▾</span>
      </button>
      <FloatingPopover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={240} estimatedHeight={340}>
        <div className="max-h-80 overflow-y-auto p-2">
          <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-gray-100">
            <button type="button" onClick={() => onChange(allKeys)} className="text-[11px] font-semibold text-[#164FA3] hover:underline">Select all</button>
            <span className="text-[11px] text-gray-400">{count}/{total} selected</span>
          </div>
          {columns.map((c) => (
            <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={selected.includes(c.key)}
                onChange={() => toggle(c.key)}
                className="accent-[#164FA3]"
              />
              <span className="text-gray-700">{c.label}</span>
            </label>
          ))}
        </div>
      </FloatingPopover>
    </>
  );
}

// Helper: return the selected keys to send to an export ONLY when the user has
// customized the selection (deselected at least one). All selected → null, so the
// server keeps its default full-column behavior (no regression).
export function exportColumnsParam(selected, allKeys) {
  if (!selected || selected.length >= allKeys.length) return null;
  return selected;
}
