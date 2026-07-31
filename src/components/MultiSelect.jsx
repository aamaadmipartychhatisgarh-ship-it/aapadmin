"use client";

import { useState, useRef } from "react";
import { ChevronDown, Search, Check } from "lucide-react";
import FloatingPopover from "@/components/FloatingPopover";

// Checkbox multi-select dropdown with a "Select All" row, an in-dropdown search
// box, and a compact summary ("Raipur, Mahasamund (+3)").
//
// Props:
//   options   [{ id, name }]
//   value     array of selected ids (strings or numbers)
//   onChange  (nextArray) => void
//   allLabel  label shown for the Select-All row and the empty/all state
//   className extra classes for the trigger button
//
// Semantics: an empty selection means "no filter" (all shown) and renders the
// Select-All row as checked. Selecting every option is treated the same way.
//
// The dropdown itself renders via FloatingPopover (portal + viewport-clamped
// fixed position) instead of `absolute` tied to the trigger's own box — this
// filter is commonly one of several narrow fields packed into a filter bar,
// where a plain `absolute` dropdown can clip against a scrolling ancestor or
// run past the right edge on mobile.
export function MultiSelect({ options, value, onChange, allLabel = "All", className = "" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const triggerRef = useRef(null);

  const ids = options.map((o) => String(o.id));
  const sel = new Set((value || []).map(String));
  // Select All is "on" when nothing is chosen (= all) or everything is chosen.
  const allChecked = sel.size === 0 || (ids.length > 0 && ids.every((id) => sel.has(id)));
  const filtered = q
    ? options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()))
    : options;

  function toggle(id) {
    const s = new Set((value || []).map(String));
    const k = String(id);
    if (s.has(k)) s.delete(k); else s.add(k);
    onChange([...s]);
  }
  // Toggling Select All either clears the filter (empty = all) or, if currently
  // cleared, leaves it cleared — both mean "all". Never materializes a full list.
  function toggleAll() { onChange([]); }

  const names = (value || [])
    .map((v) => options.find((o) => String(o.id) === String(v))?.name)
    .filter(Boolean);
  let summary;
  if (allChecked || names.length === 0) summary = allLabel;
  else if (names.length <= 2) summary = names.join(", ");
  else summary = `${names.slice(0, 2).join(", ")} (+${names.length - 2})`;

  const rowBox = (checked) =>
    `w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
      checked ? "bg-[#164FA3] border-[#164FA3] text-white" : "border-gray-300 bg-white"
    }`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`h-9 w-full px-2 rounded-lg border border-gray-200 text-sm bg-white flex items-center justify-between gap-1 ${className}`}
      >
        <span className={`truncate ${allChecked ? "text-gray-500" : "text-gray-900"}`}>{summary}</span>
        <ChevronDown size={15} className="text-gray-400 shrink-0" />
      </button>

      <FloatingPopover anchorRef={triggerRef} open={open} onClose={() => setOpen(false)} width={224} estimatedHeight={280}>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="w-full h-8 pl-7 pr-2 rounded-md border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-[#164FA3]"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-auto py-1">
            <div onClick={toggleAll} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-900 cursor-pointer hover:bg-blue-50 font-medium">
              <span className={rowBox(allChecked)}>{allChecked && <Check size={12} strokeWidth={3} />}</span>
              <span className="truncate">{allLabel}</span>
            </div>
            <div className="border-t border-gray-100 my-1" />
            {filtered.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">No matches</div>}
            {filtered.map((o) => {
              const checked = sel.has(String(o.id));
              return (
                <label key={o.id} className={`flex items-center gap-2 px-3 py-1.5 text-sm text-gray-900 cursor-pointer hover:bg-blue-50 ${checked ? "bg-blue-50" : ""}`}>
                  <input type="checkbox" className="hidden" checked={checked} onChange={() => toggle(o.id)} />
                  <span className={rowBox(checked)}>{checked && <Check size={12} strokeWidth={3} />}</span>
                  <span className="truncate">{o.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      </FloatingPopover>
    </>
  );
}
