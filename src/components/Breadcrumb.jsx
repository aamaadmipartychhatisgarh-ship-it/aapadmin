"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

// Clickable breadcrumb trail. items: [{ label, href? }] — the last item is the
// current page (not linked). Matches the existing muted-gray small-text style.
export default function Breadcrumb({ items = [] }) {
  if (!items.length) return null;
  return (
    <nav className="flex items-center flex-wrap gap-1 text-xs text-gray-400 mb-2" aria-label="Breadcrumb">
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={12} className="text-gray-300" />}
            {it.href && !last ? (
              <Link href={it.href} className="hover:text-[#164FA3] transition-colors">{it.label}</Link>
            ) : (
              <span className={last ? "text-gray-600 font-medium" : ""}>{it.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
