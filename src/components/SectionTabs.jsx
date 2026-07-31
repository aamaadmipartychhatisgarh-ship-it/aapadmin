"use client";

import Link from "next/link";
import { siblingsForPath } from "@/lib/navGroups";

// Header bar for the sibling pages in the current section — replaces the old
// sidebar accordion as the way to move between related pages (e.g. Workers /
// Teams / Users), now that the sidebar only lists one primary page per group.
// Shows plain text links (no underline, no button styling) on the left, and
// the same set as compact icon buttons with a hover tooltip on the right — a
// quicker, space-saving alternative to the text links, not a replacement.
// Renders nothing if the current page has no group or no reachable siblings.
export default function SectionTabs({ items, pathname }) {
  if (!items?.length) return null;
  const siblings = siblingsForPath(pathname, items);
  if (siblings.length < 2) return null;

  return (
    <nav className="flex items-center justify-between gap-4 px-3 lg:px-8 py-2.5 bg-white border-b border-gray-100 overflow-x-auto shrink-0">
      <div className="flex items-center gap-5">
        {siblings.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`text-sm whitespace-nowrap no-underline transition-colors ${
                active ? "text-[#164FA3] font-semibold" : "text-gray-500 hover:text-[#164FA3] font-medium"
              }`}
            >
              {item.name}
            </Link>
          );
        })}
      </div>
      <div className="hidden sm:flex items-center gap-1 shrink-0">
        {siblings.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <div key={item.href} className="relative group">
              <Link
                href={item.href}
                title={item.name}
                aria-label={item.name}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                  active ? "bg-[#164FA3]/10 text-[#164FA3]" : "text-gray-400 hover:text-[#164FA3] hover:bg-gray-50"
                }`}
              >
                <Icon size={16} />
              </Link>
              <span
                role="tooltip"
                className="pointer-events-none absolute right-0 top-full mt-1.5 whitespace-nowrap bg-gray-900 text-white text-xs font-medium px-2.5 py-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 shadow-lg"
              >
                {item.name}
              </span>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
