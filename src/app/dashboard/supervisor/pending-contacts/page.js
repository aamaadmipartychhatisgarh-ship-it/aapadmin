"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Check, X, Loader2, UserCheck, Phone, MapPin, Clock } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import Avatar from "@/components/Avatar";
import { isOversight, isSupervisorRole } from "@/lib/permissions";
import { usePageGuard } from "@/components/usePageGuard";

// Supervisor review queue for caller-submitted contacts. Approve sends the SAME
// contact row live; Reject keeps it out of every list. Enforced server-side.
export default function PendingContactsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { ready, allowed } = usePageGuard("pending_contacts", isOversight(session) || isSupervisorRole(session));

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState("pending"); // pending | rejected

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`/api/contacts/pending?status=${tab}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || "Could not load pending contacts."); setRows([]); return; }
      setRows(d.contacts || []);
    } finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  async function act(id, action, name) {
    // Hard guard against repeat clicks: while ANY request is in flight nothing else
    // can start (the API also refuses a second update of the same contact).
    if (busyId != null) return;
    setErr(""); setMsg("");
    const body = { action };
    if (action === "approve") {
      if (!window.confirm(`Approve ${name || "this contact"}? It will go live in the Contact List.`)) return;
    } else {
      const reason = window.prompt(`Reason for rejecting ${name || "this contact"} (optional):`, "");
      if (reason === null) return; // cancelled
      body.reason = reason;
    }
    setBusyId(id);
    try {
      const r = await fetch(`/api/contacts/pending/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr([d.message, d.detail].filter(Boolean).join(" — ") || "Action failed.");
        // A conflict (already processed elsewhere) or an out-of-scope id means this
        // row is stale — refresh so the list shows the real state.
        if (r.status === 409 || r.status === 403 || r.status === 404) load();
        return;
      }
      // The processed contact leaves the Pending list immediately (the list is
      // re-read from the database right after, so what shows is what was saved).
      setRows((cur) => cur.filter((c) => c.id !== id));
      setMsg(action === "approve" ? "Contact approved — it is now in the Contact List." : "Contact rejected — kept under the Rejected tab; the caller can resubmit.");
      setTimeout(() => setMsg(""), 3500);
      load();
    } catch {
      setErr("Network error — the action may not have been saved. Refresh to check.");
    } finally { setBusyId(null); }
  }

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={UserCheck}
        title="Pending Approval"
        description="Contacts your callers submitted. Review the details, then approve (goes live in the Contact List) or reject (kept here with your reason)."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/supervisor" }, { label: "Contacts", href: "/dashboard/supervisor/contacts" }, { label: "Pending Approval" }]}
      />

      <div className="flex items-center gap-2">
        {[["pending", "Pending"], ["rejected", "Rejected"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab === k ? "bg-[#164FA3] text-white" : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
            {l}
          </button>
        ))}
        <button onClick={load} className="ml-auto text-sm text-[#164FA3] font-semibold hover:underline">Refresh</button>
      </div>

      {err && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">{err}</div>}
      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3 text-sm">{msg}</div>}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400"><Loader2 className="inline animate-spin text-[#164FA3]" /></div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">{tab === "rejected" ? "No rejected submissions." : "No contacts awaiting approval."}</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((c) => (
              <li key={c.id} className="p-4 flex items-center gap-4 hover:bg-gray-50/60">
                <Avatar name={c.person_name} src={c.photo_url} size={44} className="bg-[#164FA3]/10 border border-gray-200 shrink-0" textClassName="text-[#164FA3] text-sm" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-gray-900 truncate flex items-center gap-2">
                    {c.person_name}
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${c.approval_status === "rejected" ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                      {c.approval_status === "rejected" ? "Rejected" : "Pending"}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                    <span className="inline-flex items-center gap-1"><Phone size={11} /> {c.phone_number || "—"}</span>
                    {(c.designation_names || c.designation_name) && <span>{c.designation_names || c.designation_name}</span>}
                    {(c.district_name || c.assembly_name || c.lok_sabha_name || c.zone_name) && <span className="inline-flex items-center gap-1"><MapPin size={11} /> {[c.block_name, c.assembly_name, c.district_name, c.lok_sabha_name, c.zone_name].filter(Boolean).join(", ")}</span>}
                    {c.address && <span className="truncate max-w-[260px]" title={c.address}>{c.address}</span>}
                  </div>
                  <div className="text-xs mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span className="inline-flex items-center gap-1 font-semibold text-[#164FA3]"><Clock size={11} /> Caller submission{c.created_by_name ? ` by ${c.created_by_name}` : ""}{c.created_at ? ` · ${new Date(c.created_at).toLocaleDateString("en-GB")}` : ""}</span>
                    {c.approval_status === "rejected" && (
                      <span className="text-red-700">Rejected{c.reviewed_by_name ? ` by ${c.reviewed_by_name}` : ""}{c.rejection_reason ? `: ${c.rejection_reason}` : ""}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => act(c.id, "approve", c.person_name)} disabled={busyId != null}
                    className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                    {busyId === c.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Approve
                  </button>
                  {tab !== "rejected" && <button onClick={() => act(c.id, "reject", c.person_name)} disabled={busyId != null}
                    className="inline-flex items-center gap-1.5 bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
                    <X size={15} /> Reject
                  </button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
