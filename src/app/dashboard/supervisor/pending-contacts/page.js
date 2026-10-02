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
  const [tab, setTab] = useState("pending"); // pending | rejected
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

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

  async function act(id, action) {
    setBusyId(id); setErr(""); setMsg("");
    try {
      const body = { action };
      if (action === "reject") {
        const reason = window.prompt("Reason for rejecting this contact (optional):", "");
        if (reason === null) { setBusyId(null); return; } // cancelled
        body.reason = reason;
      }
      const r = await fetch(`/api/contacts/pending/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr([d.message, d.detail].filter(Boolean).join(" — ") || "Action failed."); return; }
      setMsg(action === "approve" ? "Contact approved — it is now live." : "Contact rejected.");
      setTimeout(() => setMsg(""), 2500);
      load();
    } finally { setBusyId(null); }
  }

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={UserCheck}
        title="Pending Contacts"
        description="Contacts your callers submitted, awaiting your approval before they go live."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/supervisor" }, { label: "Contacts", href: "/dashboard/supervisor/contacts" }, { label: "Pending Approval" }]}
      />

      <div className="flex items-center gap-2">
        {[["pending", "Pending"], ["rejected", "Rejected"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border ${tab === k ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
            {lbl}
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
          <div className="py-16 text-center text-gray-400 text-sm">No {tab} contacts.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((c) => (
              <li key={c.id} className="p-4 flex items-center gap-4 hover:bg-gray-50/60">
                <Avatar name={c.person_name} src={c.photo_url} size={44} className="bg-[#164FA3]/10 border border-gray-200 shrink-0" textClassName="text-[#164FA3] text-sm" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-gray-900 truncate">{c.person_name}</div>
                  <div className="text-xs text-gray-500 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                    <span className="inline-flex items-center gap-1"><Phone size={11} /> {c.phone_number || "—"}</span>
                    {c.designation_name && <span>{c.designation_name}</span>}
                    {(c.district_name || c.assembly_name) && <span className="inline-flex items-center gap-1"><MapPin size={11} /> {[c.assembly_name, c.district_name].filter(Boolean).join(", ")}</span>}
                    {c.created_by_name && <span className="inline-flex items-center gap-1"><Clock size={11} /> Added by {c.created_by_name}</span>}
                  </div>
                </div>
                {tab === "pending" && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => act(c.id, "approve")} disabled={busyId === c.id}
                      className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                      {busyId === c.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Approve
                    </button>
                    <button onClick={() => act(c.id, "reject")} disabled={busyId === c.id}
                      className="inline-flex items-center gap-1.5 bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
                      <X size={15} /> Reject
                    </button>
                  </div>
                )}
                {tab === "rejected" && (
                  <button onClick={() => act(c.id, "approve")} disabled={busyId === c.id}
                    className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 shrink-0">
                    {busyId === c.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Approve anyway
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
