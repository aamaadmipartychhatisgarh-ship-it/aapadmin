"use client";

import { useEffect, useState, use } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Flag, CheckCircle2, XCircle, Phone } from "lucide-react";
import PageHeader from "@/components/PageHeader";

const REASON_LABEL = { wrong_number: "Wrong Number", switched_off: "Switched Off" };
const STATUS_LABEL = { pending: "Pending", corrected: "Corrected", rejected: "Rejected", resolved: "Resolved" };

// Step 4 of the number-correction workflow — a lightweight, non-admin-gated
// page a notified designation-holder lands on from their notification link.
// Reachable by ANY authenticated user (the dashboard shell only requires a
// session); the API itself is what checks whether THIS user is actually the
// assigned recipient (or an oversight admin) for THIS specific request.
export default function Page({ params }) {
  const { id } = use(params);
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  if (status !== "authenticated") {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body id={id} />;
}

function Body({ id }) {
  const [req, setReq] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [phone, setPhone] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(""); // "corrected" | "rejected"

  useEffect(() => { load(); }, [id]);
  async function load() {
    setLoading(true); setErr("");
    const r = await fetch(`/api/number-corrections/${id}`);
    if (!r.ok) { setErr(r.status === 401 ? "You don't have access to this correction task." : "Not found."); setLoading(false); return; }
    const d = await r.json();
    setReq(d.request);
    setPhone(d.request.original_phone_number || "");
    setLoading(false);
  }

  async function act(action, extra) {
    setBusy(true); setErr("");
    const r = await fetch(`/api/number-corrections/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.message || "Failed"); return; }
    setDone(action === "correct" ? "corrected" : "rejected");
  }

  return (
    <div className="space-y-6 max-w-lg animate-in fade-in duration-500">
      <PageHeader
        icon={Flag}
        title="Number Correction Task"
        description="Verify the contact's number and submit a correction, or let us know it can't be fixed."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Number Correction" }]}
      />

      {loading && <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin text-[#164FA3]" /></div>}
      {err && !loading && <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm">{err}</div>}

      {req && !loading && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <div>
            <div className="text-lg font-bold text-gray-900">{req.person_name}</div>
            <div className="text-sm text-gray-500 font-mono flex items-center gap-1.5"><Phone size={13} /> {req.original_phone_number}</div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-semibold">{REASON_LABEL[req.reason] || req.reason}</span>
            <span className="px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 font-semibold">{STATUS_LABEL[req.status] || req.status}</span>
          </div>
          {req.note && <p className="text-sm text-gray-600 italic">"{req.note}"</p>}

          {req.status !== "pending" ? (
            <div className="text-sm text-gray-500 pt-2 border-t border-gray-100">
              This request is already {STATUS_LABEL[req.status]?.toLowerCase()} — nothing left to do here.
              {req.corrected_phone_number && <div className="mt-1 font-mono text-gray-800">New number: {req.corrected_phone_number}</div>}
            </div>
          ) : done === "corrected" ? (
            <div className="flex items-center gap-2 text-emerald-700 font-semibold py-2"><CheckCircle2 size={18} /> Correction submitted — thank you.</div>
          ) : done === "rejected" ? (
            <div className="flex items-center gap-2 text-gray-600 font-semibold py-2"><XCircle size={18} /> Marked as unable to fix.</div>
          ) : !showReject ? (
            <div className="space-y-3 pt-2 border-t border-gray-100">
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Corrected phone number</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="New number" />
              <div className="flex gap-2">
                <button onClick={() => act("correct", { corrected_phone_number: phone })} disabled={busy || !phone.trim()} className="flex-1 bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-semibold">
                  {busy ? "Saving…" : "Submit Correction"}
                </button>
                <button onClick={() => setShowReject(true)} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50">
                  Can't fix
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 pt-2 border-t border-gray-100">
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Why can't this be fixed?</label>
              <textarea className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none" rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason (optional)" />
              <div className="flex gap-2">
                <button onClick={() => act("reject", { rejection_reason: rejectReason })} disabled={busy} className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-semibold">
                  {busy ? "Saving…" : "Confirm Reject"}
                </button>
                <button onClick={() => setShowReject(false)} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50">
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
