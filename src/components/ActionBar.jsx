"use client";

import { useState, useRef } from "react";
import { Loader2, MoreHorizontal } from "lucide-react";
import FloatingPopover from "@/components/FloatingPopover";

// Reusable, configurable row of page actions. Each item:
//   { key, label, icon, onClick|href, variant, disabled, loading }
// variant: 'primary' (blue), 'success' (green), 'secondary' (outline, default).
// `href` items render as links (e.g. exports); everything else is a button.
// Falsy items are skipped, so callers can inline permission checks:
//   items={[ canEdit && {…}, canExport && {…} ]}
//
// Density: with 3+ actions, only the primary (or the last item, if none is
// marked primary) stays inline — everything else collapses behind a single
// "More" icon button, opening a small popup menu. Keeps every page's header
// to one compact row instead of a wall of buttons.
const VARIANTS = {
  primary: "bg-[#164FA3] hover:bg-blue-800 text-white font-semibold shadow-md",
  success: "bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm",
  secondary: "bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium shadow-sm",
  danger: "bg-white border border-red-200 hover:bg-red-50 text-red-600 font-medium shadow-sm",
};

function ActionButton({ a, compact }) {
  const Icon = a.loading ? Loader2 : a.icon;
  const cls = `inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm disabled:opacity-60 ${VARIANTS[a.variant] || VARIANTS.secondary}`;
  const inner = (<>{Icon && <Icon size={16} className={a.loading ? "animate-spin" : ""} />}{a.label}</>);
  return a.href
    ? <a href={a.href} className={cls}>{inner}</a>
    : <button type="button" onClick={a.onClick} disabled={a.disabled || a.loading} className={cls}>{inner}</button>;
}

function MenuRow({ a, onDone }) {
  const Icon = a.loading ? Loader2 : a.icon;
  const cls = "w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50";
  const inner = (<>{Icon && <Icon size={15} className={a.loading ? "animate-spin" : ""} />}{a.label}</>);
  return a.href
    ? <a href={a.href} className={cls} onClick={onDone}>{inner}</a>
    : <button type="button" onClick={() => { a.onClick?.(); onDone(); }} disabled={a.disabled || a.loading} className={cls}>{inner}</button>;
}

export default function ActionBar({ items = [], className = "" }) {
  const visible = items.filter(Boolean);
  const [open, setOpen] = useState(false);
  const moreRef = useRef(null);

  if (!visible.length) return null;

  if (visible.length <= 2) {
    return (
      <div className={`flex gap-2 flex-wrap ${className}`}>
        {visible.map((a) => <ActionButton key={a.key} a={a} />)}
      </div>
    );
  }

  const primaryIdx = visible.findIndex((a) => a.variant === "primary");
  const inlineIdx = primaryIdx >= 0 ? primaryIdx : visible.length - 1;
  const inline = visible[inlineIdx];
  const overflow = visible.filter((_, i) => i !== inlineIdx);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        ref={moreRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
        aria-expanded={open}
        className="w-10 h-10 rounded-xl border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 flex items-center justify-center shadow-sm"
      >
        <MoreHorizontal size={18} />
      </button>
      <FloatingPopover anchorRef={moreRef} open={open} onClose={() => setOpen(false)} width={224} estimatedHeight={overflow.length * 40 + 16}>
        <div className="py-1.5">
          {overflow.map((a) => <MenuRow key={a.key} a={a} onDone={() => setOpen(false)} />)}
        </div>
      </FloatingPopover>
      <ActionButton a={inline} />
    </div>
  );
}
