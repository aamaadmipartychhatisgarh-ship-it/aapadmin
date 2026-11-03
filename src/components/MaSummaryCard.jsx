"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { IndianRupee, ChevronRight } from "lucide-react";

const fmt = (n) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n) || 0);

// Dashboard card with the Amount & Expenses totals. Renders nothing unless MA is ON and the API allows this user.
export default function MaSummaryCard({ enabled }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    if (!enabled) { setS(null); return; }
    fetch("/api/amount-expenses/summary", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => setS(null));
  }, [enabled]);
  if (!enabled || !s) return null;
  return (
    <div data-testid="ma-card" className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5 text-gray-500 text-xs font-semibold uppercase tracking-wide pl-1"><IndianRupee size={14} className="text-[#164FA3]" /> Amount &amp; Expenses</div>
      {[["Amount", s.total_amount, "text-emerald-700 bg-emerald-50"], ["Expenses", s.total_expense, "text-red-700 bg-red-50"], ["Balance", s.balance, "text-[#164FA3] bg-blue-50"], ["This month (exp.)", s.month_expense, "text-amber-700 bg-amber-50"]].map(([l, v, c]) => (
        <div key={l} className={`${c} rounded-xl px-3 py-1.5 flex items-center gap-2`}><span className="font-bold text-sm">₹{fmt(v)}</span><span className="text-xs font-medium">{l}</span></div>
      ))}
      <Link href="/dashboard/admin/amount-expenses" className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-[#164FA3] hover:underline">Open <ChevronRight size={14} /></Link>
    </div>
  );
}
