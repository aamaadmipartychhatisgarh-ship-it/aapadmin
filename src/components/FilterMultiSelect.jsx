"use client";

import { useState, useRef } from "react";
import FloatingPopover from "@/components/FloatingPopover";

// Compact multi-select dropdown for filter bars (assemblies, designations).
// Shows "All …" / "N selected", opens a checkbox panel via FloatingPopover
// so it stays fully on-screen instead of clipping on mobile or inside a
// scrolled filter bar. Shared by the Contacts page and the Administration
// Contact Distribution panel — do not fork a second copy of this.
export default function FilterMultiSelect({ label, items, selected, onChange, disabled, disabledLabel }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);

  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const btnLabel = disabled ? (disabledLabel || `All ${label}`)
    : selected.length === 0 ? `All ${label}`
    : selected.length === 1 ? (items.find((i) => i.id === selected[0])?.name || `1 ${label}`)
    : `${selected.length} ${label}`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={`h-9 px-3 rounded-lg border text-sm bg-white flex items-center gap-2 disabled:opacity-50 ${selected.length ? "border-[#164FA3] text-[#164FA3] font-semibold" : "border-gray-200 text-gray-700"}`}
      >
        <span className="capitalize">{btnLabel}</span>
        <span className="text-gray-400">▾</span>
      </button>
      <FloatingPopover anchorRef={triggerRef} open={open && !disabled} onClose={() => setOpen(false)} width={224} estimatedHeight={280}>
        <div className="max-h-72 overflow-y-auto p-2">
          <div className="flex items-center justify-between px-1 pb-2 mb-1 border-b border-gray-100">
            <button type="button" onClick={() => onChange(items.map((i) => i.id))} className="text-[11px] font-semibold text-[#164FA3] hover:underline">Select all</button>
            <button type="button" onClick={() => onChange([])} className="text-[11px] font-semibold text-gray-500 hover:underline">Clear</button>
          </div>
          {items.length === 0 ? (
            <div className="px-2 py-3 text-xs text-gray-400">No {label} available.</div>
          ) : items.map((i) => (
            <label key={i.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer text-sm">
              <input type="checkbox" checked={selected.includes(i.id)} onChange={() => toggle(i.id)} className="accent-[#164FA3]" />
              <span className="text-gray-700">{i.name}</span>
            </label>
          ))}
        </div>
      </FloatingPopover>
    </>
  );
}
