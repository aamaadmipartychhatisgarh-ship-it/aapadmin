"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { UserCog, Loader2, KeyRound, Check, Search } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { isTopAdmin } from "@/lib/permissions";
import { usePageGuard } from "@/components/usePageGuard";

// Admin console: auto-provision login accounts for every eligible designation-holder
// (up to Vidhansabha). Shows who is eligible, who already has an account, and — after
// provisioning — the generated User IDs. Passwords are never shown (the default is
// the fixed '#', set server-side).
export default function PortalAccountsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { ready, allowed } = usePageGuard("portal_accounts", isTopAdmin(session));

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await fetch("/api/portal/provision", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr([d.message, d.detail].filter(Boolean).join(" — ")); return; }
      setData(d);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  async function provision() {
    if (!window.confirm("Create login accounts for all eligible members who don't have one yet?")) return;
    setRunning(true); setErr(""); setResult(null);
    try {
      const r = await fetch("/api/portal/provision", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr([d.message, d.detail].filter(Boolean).join(" — ")); return; }
      setResult(d);
      load();
    } finally { setRunning(false); }
  }

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  const people = (data?.people || []).filter((p) => {
    const needle = q.trim().toLowerCase();
    return !needle || String(p.name || "").toLowerCase().includes(needle) || String(p.phone || "").includes(needle) || String(p.username || p.would_be_user_id || "").toLowerCase().includes(needle);
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={UserCog}
        title="Member Accounts"
        description="Login accounts for designation-holders up to Vidhansabha (State, Lok Sabha, District, Assembly). Block and member-level designations are excluded."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Administration", href: "/dashboard/admin/administration" }, { label: "Member Accounts" }]}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <SumCard label="Eligible members" value={data?.eligible ?? "—"} accent />
        <SumCard label="With an account" value={data?.with_account ?? "—"} />
        <SumCard label="Need an account" value={data ? data.eligible - data.with_account : "—"} />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / phone / User ID…"
            className="w-full pl-9 h-10 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
        </div>
        <button onClick={provision} disabled={running} className="bg-[#FCB712] text-[#164FA3] px-4 py-2 rounded-lg font-bold hover:bg-yellow-500 disabled:opacity-50 inline-flex items-center gap-2">
          {running ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Create accounts
        </button>
      </div>

      {err && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">{err}</div>}
      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm">
          <div className="font-semibold text-emerald-800 mb-1">Created {result.created.length} account(s). Default password is <span className="font-mono">#</span>.</div>
          {result.created.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {result.created.map((c) => (
                <span key={c.username} className="inline-flex items-center gap-1 bg-white border border-emerald-200 rounded-md px-2 py-1 text-xs">
                  <Check size={12} className="text-emerald-600" /> <span className="font-semibold">{c.name}</span> → <span className="font-mono">{c.username}</span>
                </span>
              ))}
            </div>
          )}
          {result.skipped?.length > 0 && <div className="text-xs text-gray-500 mt-2">{result.skipped.length} skipped (already have an account or missing name/phone).</div>}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400"><Loader2 className="inline animate-spin text-[#164FA3]" /></div>
        ) : people.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No eligible members found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 bg-gray-50">
                {["Name", "Phone", "Designations", "User ID", "Account"].map((h) => <th key={h} className="px-4 py-2 font-semibold whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.contact_id} className="border-t border-gray-100 hover:bg-gray-50/60">
                    <td className="px-4 py-2.5 font-semibold text-gray-900">{p.name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600 whitespace-nowrap">{p.phone || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600 max-w-[280px]"><span className="line-clamp-2">{p.designations || "—"}</span></td>
                    <td className="px-4 py-2.5 font-mono text-xs">{p.username || p.would_be_user_id || "—"}</td>
                    <td className="px-4 py-2.5">
                      {p.username
                        ? <span className="text-[11px] font-semibold px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">Has account</span>
                        : <span className="text-[11px] font-semibold px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200">No account</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SumCard({ label, value, accent }) {
  return (
    <div className={`${accent ? "bg-[#164FA3] text-white" : "bg-white border border-gray-100"} rounded-xl p-4 shadow-sm`}>
      <div className={`text-2xl font-bold ${accent ? "" : "text-gray-900"}`}>{value}</div>
      <div className={`text-xs font-medium mt-1 ${accent ? "text-blue-200" : "text-gray-500"}`}>{label}</div>
    </div>
  );
}
