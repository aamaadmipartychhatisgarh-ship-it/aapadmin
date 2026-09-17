"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Breadcrumb from "@/components/Breadcrumb";

// Router-aware Back control (spec §2). It returns to the exact previous screen
// via browser history — so the Contacts/Call-Records search, filters, tab and
// scroll the user left behind are preserved — and, when the page was opened
// directly with NO in-app history (fresh tab, shared URL, refresh), falls back
// to the logical parent instead of a blank page, a redirect loop or a logout.
function BackButton({ href, label = "Back" }) {
  const router = useRouter();
  const onClick = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else if (href) router.push(href);
    else router.push("/dashboard");
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-[#164FA3] px-1.5 py-0.5 -ml-1.5 rounded-md hover:bg-gray-100 transition-colors"
    >
      <ArrowLeft size={16} /> {label}
    </button>
  );
}

// Universal management-page header — compact by design: an optional Back control
// + breadcrumb on one thin line, then ONE row with icon + title + description
// folded in next to it + actions on the right.
// One header per page — actions live here, never duplicated in the page body.
//
// Back button (spec §2): shown by default whenever the breadcrumb has a parent to
// return to (its fallback destination is that parent's href), giving a single,
// consistently-placed Back control across every page that uses this header. Pass
// `back={false}` to suppress it (e.g. a true top-level page, or a page that draws
// its own Back), or `backHref` / `backLabel` to override the target/label.
export default function PageHeader({ icon: Icon, title, description, breadcrumb, actions, children, back = true, backHref, backLabel }) {
  // Fallback parent = the caller's explicit backHref, else the last breadcrumb
  // entry (excluding the current page, i.e. the final crumb) that carries an href.
  const parents = Array.isArray(breadcrumb) ? breadcrumb.slice(0, -1) : [];
  const crumbFallback = [...parents].reverse().find((b) => b && b.href)?.href;
  const fallbackHref = backHref || crumbFallback;
  const showBack = back && !!fallbackHref;
  return (
    <div className="space-y-1.5">
      {(showBack || breadcrumb) && (
        <div className="flex items-center gap-2 flex-wrap">
          {showBack && <BackButton href={fallbackHref} label={backLabel} />}
          {breadcrumb && <Breadcrumb items={breadcrumb} />}
        </div>
      )}
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
