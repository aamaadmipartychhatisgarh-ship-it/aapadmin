"use client";

import { useState, useRef } from "react";
import { ChevronDown, Check, X } from "lucide-react";
import FloatingPopover from "@/components/FloatingPopover";

// Multi-select CHECKBOX dropdown for the Wings field (SELECTION semantics, NOT
// filter semantics — empty means "no wings selected", every checkbox is
// independent, and nothing is implicitly "all"). The option list is passed in by
// the parent, which sources it from Master Data → /api/wings (the single source of
// truth — no hardcoded wing list here).
//
// Props:
//   options  [{ value, label }]  value = the stored wing name; label = display text
//   value    Set<string> | string[] of selected VALUES
//   onChange (nextSet: Set<string>) => void
//   placeholder  trigger text when nothing is selected
export default function WingMultiSelect({ options = [], value, onChange, placeholder = "Select wings…", className = "" }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const sel = value instanceof Set ? value : new Set(value || []);
  // Keep selected chips in the option order so the display is stable.
  const selected = options.filter((o) => sel.has(o.value));

  function toggle(v) {
    const next = new Set(sel);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange(next);
  }
  function remove(v) {
    const next = new Set(sel);
    next.delete(v);
    onChange(next);
  }

  const box = (checked) =>
    `w-4 h-4 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-[#164FA3] border-[#164FA3] text-white" : "border-gray-300 bg-white"}`;

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full min-h-[40px] flex items-center flex-wrap gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white text-sm text-left focus:outline-none focus:ring-2 focus:ring-[#164FA3]"
      >
        {selected.length === 0 ? (
          <span className="text-gray-400">{placeholder}</span>
        ) : (
          selected.map((o) => (
            <span key={o.value} className="inline-flex items-center gap-1 bg-[#164FA3]/10 text-[#164FA3] rounded-full pl-2 pr-1 py-0.5 text-xs font-semibold">
              {o.label}
              <span
                role="button"
                tabIndex={0}
                aria-label={`Remove ${o.label}`}
                onClick={(e) => { e.stopPropagation(); remove(o.value); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); remove(o.value); } }}
                className="hover:bg-[#164FA3]/25 rounded-full p-0.5 cursor-pointer"
              >
                <X size={11} />
              </span>
            </span>
          ))
        )}
        <ChevronDown size={16} className="ml-auto text-gray-400 shrink-0" />
      </button>

      <FloatingPopover anchorRef={triggerRef} open={open} onClose={() => setOpen(false)} width={240} estimatedHeight={320}>
        <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
          <div className="max-h-72 overflow-auto py-1">
            {options.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400">No wings configured in Master Data.</div>
            ) : (
              options.map((o) => {
                const checked = sel.has(o.value);
                return (
                  <label key={o.value} className={`flex items-center gap-2.5 px-3 py-1.5 text-sm text-gray-900 cursor-pointer hover:bg-blue-50 ${checked ? "bg-blue-50" : ""}`}>
                    <input type="checkbox" className="hidden" checked={checked} onChange={() => toggle(o.value)} />
                    <span className={box(checked)}>{checked && <Check size={12} strokeWidth={3} />}</span>
                    <span className="truncate">{o.label}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </FloatingPopover>
    </div>
  );
}
