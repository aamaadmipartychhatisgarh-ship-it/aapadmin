"use client";

import Breadcrumb from "@/components/Breadcrumb";

// Universal management-page header — compact by design: breadcrumb on its own
// thin line, then ONE row with icon + title + description folded in next to
// it (not a separate paragraph) + actions on the right. Replaces the old
// 4xl-heading-plus-paragraph layout, which pushed the actual page content
// (the list/table users came for) far down the screen.
// One header per page — actions live here, never duplicated in the page body.
export default function PageHeader({ icon: Icon, title, description, breadcrumb, actions, children }) {
  return (
    <div className="space-y-1.5">
      {breadcrumb && <Breadcrumb items={breadcrumb} />}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && (
            <div className="w-8 h-8 rounded-lg bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center shrink-0">
              <Icon size={17} />
            </div>
          )}
          <h1 className="text-xl font-bold text-gray-900 tracking-tight truncate">{title}</h1>
          {description && (
            <span className="hidden md:inline text-sm text-gray-400 font-medium truncate min-w-0">— {description}</span>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
