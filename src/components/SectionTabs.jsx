"use client";

import Link from "next/link";
import { GROUPS, groupForPath } from "@/lib/navGroups";

// Horizontal row of plain text links (no underline, no button styling) for the
// sibling pages in the current section — replaces the old sidebar accordion as
// the way to move between related pages (e.g. Workers / Teams / Users).
// Renders nothing if the current page has no group or no reachable siblings.
export default function SectionTabs({ items, pathname }) {
  if (!items?.length) return null;
  const group = groupForPath(pathname);
  if (!group) return null;

  const siblings = group.hrefs.map((h) => items.find((i) => i.href === h)).filter(Boolean);
  if (siblings.length < 2) return null;

  return (
    <nav className="flex items-center gap-5 px-3 lg:px-8 py-2.5 bg-white border-b border-gray-100 overflow-x-auto shrink-0">
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
    </nav>
  );
}
