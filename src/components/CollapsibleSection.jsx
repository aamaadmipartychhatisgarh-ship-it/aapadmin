"use client";

import { useState, useEffect } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

// Reusable expand/hide wrapper for filter bars, bulk-action panels, and any
// other section that otherwise stays permanently expanded and crowds the
// results below it. Collapsed state can be uncontrolled (defaultExpanded,
// used as-is on most pages) or controlled (pass `expanded`/`onToggle` —
// Reports Center uses this to auto-collapse once results load).
//
// Pass `storageKey` to offer a "Keep this open" checkbox — when checked, the
// section stays expanded across visits (persisted to localStorage) and the
// header no longer bothers auto-collapsing behavior tied to that key.
export default function CollapsibleSection({
  title = "Search & Filters",
  defaultExpanded = true,
  expanded: expandedProp,
  onToggle,
  storageKey,
  className = "bg-white border-gray-100",
  children,
}) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const [keepOpen, setKeepOpen] = useState(false);

  // On mount, if this section has a persisted "keep open" preference, honor it.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(`collapsible_keepopen_${storageKey}`);
      if (saved === "1") { setKeepOpen(true); setInternalExpanded(true); }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const isControlled = expandedProp !== undefined;
  const expanded = isControlled ? expandedProp : internalExpanded;

  const toggle = () => {
    const next = !expanded;
    if (!isControlled) setInternalExpanded(next);
    onToggle?.(next);
  };

  const toggleKeepOpen = (checked) => {
    setKeepOpen(checked);
    try {
      if (storageKey) {
        if (checked) localStorage.setItem(`collapsible_keepopen_${storageKey}`, "1");
        else localStorage.removeItem(`collapsible_keepopen_${storageKey}`);
      }
    } catch {}
    if (checked && !expanded) { if (!isControlled) setInternalExpanded(true); onToggle?.(true); }
  };

  return (
    // No overflow-hidden here — filter fields commonly pop open an absolutely
    // positioned dropdown (MultiSelect, date pickers, etc.) below their own
    // input, which clipping would cut off. Content is either fully shown or
    // fully removed (no partial-height animation), so nothing needs clipping.
    <div className={`rounded-2xl border shadow-sm ${className}`}>
      <div className="w-full flex items-center justify-between gap-2 px-4 py-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="flex-1 flex items-center gap-2 text-left min-w-0"
        >
          <span className="text-sm font-semibold text-gray-700 truncate">{title}</span>
        </button>
        <div className="flex items-center gap-3 shrink-0">
          {storageKey && (
            <label className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400 font-medium cursor-pointer select-none">
              <input
                type="checkbox"
                checked={keepOpen}
                onChange={(e) => toggleKeepOpen(e.target.checked)}
                className="rounded border-gray-300 text-[#164FA3] focus:ring-[#164FA3]"
              />
              Keep open
            </label>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-[#164FA3] hover:bg-gray-50 transition-colors shrink-0"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>
      {expanded && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}
