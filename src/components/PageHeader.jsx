"use client";

import Breadcrumb from "@/components/Breadcrumb";

// Universal management-page header: breadcrumb, icon + title + description on the
// left, and contextual actions (an <ActionBar/> or any node) on the right. Keeps
// the existing theme (4xl bold title, muted description, brand-blue icon chip).
// One header per page — actions live here, never duplicated in the page body.
export default function PageHeader({ icon: Icon, title, description, breadcrumb, actions, children }) {
  return (
    <div>
      {breadcrumb && <Breadcrumb items={breadcrumb} />}
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          {Icon && (
            <div className="w-11 h-11 rounded-xl bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center shrink-0">
              <Icon size={22} />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-4xl font-bold text-gray-900 tracking-tight">{title}</h1>
            {description && <p className="text-gray-500 mt-2 font-medium">{description}</p>}
          </div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
