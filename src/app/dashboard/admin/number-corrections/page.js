"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { isOversight } from "@/lib/permissions";
import { usePageGuard } from "@/components/usePageGuard";
import { Flag, Loader2, CheckCircle2, XCircle, Clock, RotateCcw } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import Avatar from "@/components/Avatar";

export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  // Role OR a Page-Access grant for this page (managed override).
  const { ready, allowed } = usePageGuard("number_corrections", isOversight(session));
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);
  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body />;
}

const TABS = [
  { key: "pending", label: "Pending", icon: Clock, color: "text-amber-600" },
  { key: "corrected", label: "Corrected", icon: CheckCircle2, color: "text-emerald-600" },
  { key: "rejected", label: "Rejected", icon: XCircle, color: "text-red-600" },
  { key: "resolved", label: "Resolved", icon: RotateCcw, color: "text-gray-500" },
];

const REASON_LABEL = { wrong_number: "Wrong Number", switched_off: "Switched Off" };
const fmt = (d) => d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function Body() {
  const [tab, setTab] = useState("pending");
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [designations, setDesignations] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [verifyPicks, setVerifyPicks] = useState({}); // request id -> chosen designation id

  useEffect(() => {
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || [])).catch(() => {});
  }, []);

  useEffect(() => { load(); loadCounts(); }, [tab]);

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/number-corrections?status=${tab}`, { cache: "no-store" });
    if (r.ok) { const d = await r.json(); setRows(d.requests || []); }
    setLoading(false);
  }

  async function loadCounts() {
    const results = await Promise.all(TABS.map((t) => fetch(`/api/number-corrections?status=${t.key}`, { cache: "no-store" }).then((r) => r.ok ? r.json() : { requests: [] })));
    const next = {};
    TABS.forEach((t, i) => { next[t.key] = results[i].requests?.length || 0; });
    setCounts(next);
  }

  async function act(id, action, extra) {
    setBusyId(id); setMessage(""); setError("");
    const r = await fetch(`/api/number-corrections/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const d = await r.json().catch(() => ({}));
    setBusyId(null);
    if (!r.ok) { setError(d.message || "Action failed"); return; }
    setMessage(
      action === "verify" ? `Routed to designation — notified ${d.recipients ?? 0} recipient(s).`
        : action === "correct" ? "Number corrected and applied to the contact."
        : action === "reject" ? "Rejected."
        : "Marked resolved."
    );
    load(); loadCounts();
  }

  function verify(id) {
    const designationId = verifyPicks[id];
    if (!designationId) { setError("Pick a designation first."); return; }
    act(id, "verify", { designation_id: Number(designationId) });
  }
  function reject(id) {
    const reason = prompt("Reason for rejecting (optional):") || undefined;
    act(id, "reject", { rejection_reason: reason });
  }
  function correct(id) {
    const newNumber = prompt("Corrected phone number:");
    if (!newNumber) return;
    act(id, "correct", { corrected_phone_number: newNumber.trim() });
  }
  function resolve(id) {
    act(id, "resolve");
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={Flag}
        title="Number Corrections"
        description="Wrong-number and switched-off reports from callers — verify, route to a designation, and track through to resolution."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "People" }, { label: "Number Corrections" }]}
      />

      {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 text-sm">{message}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">{error}</div>}

      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border ${tab === t.key ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
              <Icon size={15} className={tab === t.key ? "" : t.color} /> {t.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${tab === t.key ? "bg-white/20" : "bg-gray-100"}`}>{counts[t.key] ?? "…"}</span>
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-gray-400"><Flag size={36} className="mx-auto text-gray-300 mb-3" />No {tab} requests.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold text-gray-600">Contact</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Reason</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Reported</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Detail</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 align-top">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar name={r.person_name} size={30} className="bg-amber-50 border border-amber-100" textClassName="text-amber-700 text-[10px]" />
                        <div>
                          <div className="font-medium text-gray-900">{r.person_name}</div>
                          <div className="text-xs text-gray-500 font-mono">{r.original_phone_number}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-700">{REASON_LABEL[r.reason] || r.reason}</span>
                      {r.note && <div className="text-xs text-gray-500 mt-1 italic max-w-[180px] truncate" title={r.note}>"{r.note}"</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {r.reported_by_username || "—"}<br />{fmt(r.reported_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {tab === "pending" && (r.target_designation_name
                        ? <>Awaiting <strong>{r.target_designation_name}</strong> correction</>
                        : "Awaiting supervisor verification")}
                      {tab === "corrected" && <>New: <span className="font-mono text-gray-800">{r.corrected_phone_number}</span><br />by {r.corrected_by_username}, {fmt(r.corrected_at)}</>}
                      {tab === "rejected" && <>by {r.rejected_by_username}, {fmt(r.rejected_at)}{r.rejection_reason && <div className="italic mt-0.5">"{r.rejection_reason}"</div>}</>}
                      {tab === "resolved" && <>by {r.resolved_by_username}, {fmt(r.resolved_at)}</>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {tab === "pending" && !r.target_designation_name && (
                        <div className="flex items-center gap-1.5 justify-end">
                          <select
                            value={verifyPicks[r.id] || ""}
                            onChange={(e) => setVerifyPicks((p) => ({ ...p, [r.id]: e.target.value }))}
                            className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white"
                          >
                            <option value="">Designation…</option>
                            {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                          <button onClick={() => verify(r.id)} disabled={busyId === r.id} className="text-xs text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded-lg font-medium">Verify</button>
                          <button onClick={() => reject(r.id)} disabled={busyId === r.id} className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg font-medium">Reject</button>
                        </div>
                      )}
                      {tab === "pending" && r.target_designation_name && (
                        <div className="flex items-center gap-1.5 justify-end">
                          <button onClick={() => correct(r.id)} disabled={busyId === r.id} className="text-xs text-[#164FA3] hover:bg-blue-50 px-2 py-1 rounded-lg font-medium">Correct</button>
                          <button onClick={() => reject(r.id)} disabled={busyId === r.id} className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg font-medium">Reject</button>
                        </div>
                      )}
                      {tab === "corrected" && (
                        <button onClick={() => resolve(r.id)} disabled={busyId === r.id} className="text-xs text-[#164FA3] hover:bg-blue-50 px-2 py-1 rounded-lg font-medium">Mark Resolved</button>
                      )}
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
