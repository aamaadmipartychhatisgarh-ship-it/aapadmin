"use client";

import { Loader2 } from "lucide-react";

// Reusable, configurable row of page actions. Each item:
//   { key, label, icon, onClick|href, variant, disabled, loading }
// variant: 'primary' (blue), 'success' (green), 'secondary' (outline, default).
// `href` items render as links (e.g. exports); everything else is a button.
// Falsy items are skipped, so callers can inline permission checks:
//   items={[ canEdit && {…}, canExport && {…} ]}
const VARIANTS = {
  primary: "bg-[#164FA3] hover:bg-blue-800 text-white font-semibold shadow-md",
  success: "bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm",
  secondary: "bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium shadow-sm",
  danger: "bg-white border border-red-200 hover:bg-red-50 text-red-600 font-medium shadow-sm",
};

export default function ActionBar({ items = [], className = "" }) {
  const visible = items.filter(Boolean);
  if (!visible.length) return null;
  return (
    <div className={`flex gap-2 flex-wrap ${className}`}>
      {visible.map((a) => {
        const Icon = a.loading ? Loader2 : a.icon;
        const cls = `inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm disabled:opacity-60 ${VARIANTS[a.variant] || VARIANTS.secondary}`;
        const inner = (<>{Icon && <Icon size={16} className={a.loading ? "animate-spin" : ""} />}{a.label}</>);
        return a.href
          ? <a key={a.key} href={a.href} className={cls}>{inner}</a>
          : <button key={a.key} type="button" onClick={a.onClick} disabled={a.disabled || a.loading} className={cls}>{inner}</button>;
      })}
    </div>
  );
}
