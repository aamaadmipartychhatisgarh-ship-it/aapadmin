"use client";

import { useRef, useState } from "react";
import FloatingPopover from "@/components/FloatingPopover";

// A compact "Columns" dropdown for choosing which columns an export includes.
// Shows a checkbox per exportable column (all selected by default), with "Select all" and "Deselect all" so a user can clear
// everything and tick just the few columns they want. An empty selection is allowed while choosing; the exports refuse to run
// with no column selected (see hasNoColumns) and this picker says so.
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
    // Keep the canonical column order whatever order the boxes are ticked in.
    onChange(has ? selected.filter((k) => k !== key) : allKeys.filter((k) => k === key || selected.includes(k)));
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid="column-picker"
        className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-semibold bg-white hover:bg-gray-50 ${count === 0 ? "border-red-300 text-red-600" : count < total ? "border-[#164FA3] text-[#164FA3]" : "border-gray-200 text-gray-700"}`}
        title="Choose which columns to export"
      >
        {label}{count < total ? ` (${count}/${total})` : ""}
        <span className="text-gray-400">▾</span>
      </button>
      <FloatingPopover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={240} estimatedHeight={340}>
        <div className="max-h-80 overflow-y-auto p-2">
          <div className="flex items-center gap-3 px-1 pb-2 mb-1 border-b border-gray-100">
            <button type="button" onClick={() => onChange(allKeys)} disabled={count === total} data-testid="column-select-all"
              className="py-1 text-[11px] font-semibold text-[#164FA3] hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-default">Select all</button>
            <button type="button" onClick={() => onChange([])} disabled={count === 0} data-testid="column-deselect-all"
              className="py-1 text-[11px] font-semibold text-[#164FA3] hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-default">Deselect all</button>
            <span className="ml-auto text-[11px] text-gray-400" data-testid="column-count">{count}/{total} selected</span>
          </div>
          {count === 0 && <div className="mx-1 mb-1 px-2 py-1.5 rounded-md bg-red-50 text-[11px] text-red-600" data-testid="column-none">Select at least one column to export.</div>}
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

// True when no column is selected: an export must not run (callers show NO_COLUMNS_MESSAGE instead).
export const NO_COLUMNS_MESSAGE = "Select at least one column under Columns to export.";
export function hasNoColumns(selected) {
  return !selected || selected.length === 0;
}

// Helper: return the selected keys to send to an export ONLY when the user has
// customized the selection (deselected at least one). All selected → null, so the
// server keeps its default full-column behavior (no regression).
export function exportColumnsParam(selected, allKeys) {
  if (!selected || selected.length >= allKeys.length) return null;
  return selected;
}
