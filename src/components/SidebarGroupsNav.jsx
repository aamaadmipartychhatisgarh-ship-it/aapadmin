"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ChevronRight, ChevronDown, Search, X, LayoutDashboard,
  Users, PhoneCall, ClipboardList, BarChart3, Map, Newspaper, Settings, Folder,
} from "lucide-react";

// Grouped (accordion) navigation for admin roles. Reorganizes the SAME menu
// items (same routes/permissions) into collapsible sections — it never invents
// routes or changes theme. Each group renders only the items the role actually
// has (items are already permission-filtered upstream), and a group with no
// permitted items is hidden entirely. Expanded state persists (localStorage) and
// the group containing the current page auto-expands.
//
// Groups are keyed by href so they're robust to label changes. Any admin item
// not matched by a group falls into a trailing "More" group so nothing is lost.
const DASHBOARD_HREF = "/dashboard/admin";
const GROUPS = [
  { key: "people", label: "People Management", icon: Users, hrefs: ["/dashboard/admin/workers", "/dashboard/admin/teams", "/dashboard/admin/users"] },
  { key: "calling", label: "Calling Management", icon: PhoneCall, hrefs: ["/dashboard/admin/contacts", "/dashboard/admin/calls", "/dashboard/admin/caller-report", "/dashboard/admin/assignment-rules", "/dashboard/admin/wrong-numbers"] },
  { key: "tasks", label: "Task Management", icon: ClipboardList, hrefs: ["/dashboard/tasks", "/dashboard/admin/events", "/dashboard/admin/complaints"] },
  { key: "analytics", label: "Analytics", icon: BarChart3, hrefs: ["/dashboard/analytics", "/dashboard/reports", "/dashboard/rankings", "/dashboard/strength"] },
  { key: "monitoring", label: "Monitoring", icon: Map, hrefs: ["/dashboard/map", "/dashboard/social", "/dashboard/social-management"] },
  { key: "content", label: "Content", icon: Newspaper, hrefs: ["/dashboard/media"] },
  { key: "admin", label: "Administration", icon: Settings, hrefs: ["/dashboard/admin/settings", "/dashboard/admin/audit"] },
];

export default function SidebarGroupsNav({ items, pathname, onNavigate }) {
  const dashboard = items.find((i) => i.href === DASHBOARD_HREF);

  // Bucket items into groups (in-group order follows the group's href order),
  // then a trailing "More" group for anything unmapped.
  const used = new Set(dashboard ? [DASHBOARD_HREF] : []);
  const groups = GROUPS.map((g) => {
    const children = g.hrefs.map((h) => items.find((i) => i.href === h)).filter(Boolean);
    children.forEach((c) => used.add(c.href));
    return { ...g, children };
  }).filter((g) => g.children.length > 0);
  const leftover = items.filter((i) => !used.has(i.href));
  if (leftover.length) groups.push({ key: "more", label: "More", icon: Folder, children: leftover });

  // Which group (if any) owns the current route.
  const activeGroupKey = groups.find((g) => g.children.some((c) => c.href === pathname))?.key || null;

  // Minimalist: at most ONE group open at a time. Starts fully collapsed;
  // remembers the last-opened group across navigations (localStorage).
  const [openKey, setOpenKey] = useState(null);

  useEffect(() => {
    try { setOpenKey(localStorage.getItem("sidebar_group_open") || null); } catch {}
  }, []);

  const toggle = (key) => {
    setOpenKey((prev) => {
      const next = prev === key ? null : key; // clicking the open one closes it
      try { next ? localStorage.setItem("sidebar_group_open", next) : localStorage.removeItem("sidebar_group_open"); } catch {}
      return next;
    });
  };

  const query = q.trim().toLowerCase();
  const searching = query.length > 0;
  const matches = (name) => name.toLowerCase().includes(query);

  const childLink = (item, indent = true) => {
    const isActive = pathname === item.href;
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        className={`flex items-center gap-3 ${indent ? "pl-11 pr-6" : "px-6"} py-2.5 transition-all ${
          isActive
            ? "bg-[#1d4c94] text-white border-l-4 border-white font-semibold"
            : "text-blue-100 hover:text-white hover:bg-white/5 border-l-4 border-transparent font-medium"
        }`}
      >
        <Icon size={indent ? 17 : 20} className={isActive ? "text-white" : "text-blue-200"} />
        <span className="flex-1 truncate text-[15px]">{item.name}</span>
      </Link>
    );
  };

  return (
    <nav className="flex-1 py-4 overflow-y-auto">
      {/* Search */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-blue-300 pointer-events-none" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search menu…"
            className="w-full h-8 pl-8 pr-7 rounded-md bg-white/10 text-white placeholder:text-blue-300 text-sm outline-none focus:bg-white/15"
          />
          {q && <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-300 hover:text-white"><X size={14} /></button>}
        </div>
      </div>

      {/* Dashboard (standalone) */}
      {dashboard && (!searching || matches(dashboard.name)) && childLink(dashboard, false)}

      {searching
        ? // Flat filtered results across all groups
          groups.flatMap((g) => g.children.filter((c) => matches(c.name) || matches(g.label))).map((c) => childLink(c, false))
        : groups.map((g) => {
            const isOpen = openKey === g.key;
            const groupActive = g.key === activeGroupKey;
            const GIcon = g.icon;
            return (
              <div key={g.key}>
                <button
                  onClick={() => toggle(g.key)}
                  aria-expanded={isOpen}
                  className={`w-full flex items-center gap-3 px-6 py-3 transition-all border-l-4 ${
                    groupActive ? "text-white border-transparent" : "text-blue-100 hover:text-white hover:bg-white/5 border-transparent"
                  } font-medium`}
                >
                  <GIcon size={20} className={groupActive ? "text-white" : "text-blue-200"} />
                  <span className="flex-1 text-left truncate">{g.label}</span>
                  <span className="text-[11px] text-blue-300 mr-1">{g.children.length}</span>
                  {isOpen ? <ChevronDown size={16} className="text-blue-300" /> : <ChevronRight size={16} className="text-blue-300" />}
                </button>
                {/* Smooth expand/collapse */}
                <div className={`grid transition-all duration-200 ease-in-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <div className="overflow-hidden">
                    {g.children.map((c) => childLink(c, true))}
                  </div>
                </div>
              </div>
            );
          })}
    </nav>
  );
}
