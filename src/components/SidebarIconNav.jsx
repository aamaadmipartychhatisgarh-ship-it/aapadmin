"use client";

import Link from "next/link";

// Compact icon-only sidebar rail for admin roles — no accordion, no grouping,
// every page reachable in one click. Each icon shows its name in a tooltip on
// hover (and via the native title attribute as a fallback). The sibling pages
// that used to live inside an accordion group now surface as text-link tabs
// under the page header instead (see SectionTabs).
export default function SidebarIconNav({ items, pathname, onNavigate }) {
  return (
    <nav className="flex-1 py-4 overflow-y-auto flex flex-col items-center gap-1.5">
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <div key={item.href} className="relative group w-full flex justify-center">
            <Link
              href={item.href}
              onClick={onNavigate}
              title={item.name}
              aria-label={item.name}
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                isActive ? "bg-white text-[#0B3A82]" : "text-blue-100 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon size={20} />
            </Link>
            <span
              role="tooltip"
              className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 shadow-lg"
            >
              {item.name}
            </span>
          </div>
        );
      })}
    </nav>
  );
}
