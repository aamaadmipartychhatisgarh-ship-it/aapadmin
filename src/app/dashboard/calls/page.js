"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Phone, Plus, Search, Loader2, Star, X, Pencil, MapPin } from "lucide-react";
import { isOversight } from "@/lib/permissions";

const STATUS_PILL = {
  "Phone Picked":   "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Not Picked":     "bg-amber-50 text-amber-700 border-amber-200",
  "Wrong Number":   "bg-gray-100 text-gray-600 border-gray-200",
  "Rudely Behaved": "bg-red-50 text-red-700 border-red-200",
  "Busy":           "bg-purple-50 text-purple-700 border-purple-200",
  "Switched Off":   "bg-sky-50 text-sky-700 border-sky-200",
};
const SENTIMENT_LABEL = {
  positive: "Positive", supporter: "Supporter", neutral: "Neutral",
  negative: "Negative", opponent: "Opponent", not_supporter: "Not a Supporter",
};

function fmtDur(s) {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function CallsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [calls, setCalls] = useState([]);
  const [search, setSearch] = useState("");
  const [designations, setDesignations] = useState([]);
  const [designationId, setDesignationId] = useState("");
  const [statuses, setStatuses] = useState([]);
  const [statusId, setStatusId] = useState("");
  const [sentiment, setSentiment] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null); // call selected for view/edit

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && isOversight(session)) {
      // Admin/supervisor have their own pages — send them home.
      router.push("/dashboard");
    }
  }, [status, session, router]);

  useEffect(() => {
    fetch("/api/designations").then((r) => r.ok ? r.json() : { designations: [] }).then((d) => setDesignations(d.designations || []));
    fetch("/api/statuses").then((r) => r.ok ? r.json() : { statuses: [] }).then((d) => setStatuses(d.statuses || []));
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || isOversight(session)) return;
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session, search, designationId, statusId, sentiment, dateFrom, dateTo]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (designationId) params.set("designation_id", designationId);
    if (statusId) params.set("status_id", statusId);
    if (sentiment) params.set("sentiment", sentiment);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    try {
      const r = await fetch(`/api/calls?${params}`);
      if (r.ok) setCalls((await r.json()).calls || []);
    } finally {
      setLoading(false);
    }
  }

  if (status !== "authenticated" || !session) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">My Calls</h1>
          <p className="text-gray-500 mt-2 font-medium">Every call you've logged. Newest first.</p>
        </div>
        <Link href="/dashboard/calls/new" className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-md">
          <Plus size={16} /> Log a Call
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-3 flex-wrap">
        <Search size={18} className="text-gray-400 ml-2" />
        <input
          type="text"
          placeholder="Search by name or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] outline-none text-sm py-2"
        />
        <select value={designationId} onChange={(e) => setDesignationId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All designations</option>
          {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={statusId} onChange={(e) => setStatusId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={sentiment} onChange={(e) => setSentiment(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All sentiments</option>
          {Object.entries(SENTIMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="From date" className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="To date" className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>
        ) : calls.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Phone size={36} className="mx-auto text-gray-300 mb-3" />
            No calls yet. Click <Link href="/dashboard/workspace" className="text-[#164FA3] font-semibold hover:underline">Start Calling</Link> to begin.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold text-gray-600">When</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Person</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Phone</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Designation</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">District</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Sentiment</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 text-right">Duration</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Remarks</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 text-right">Details</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id} onClick={() => setDetail(c)} className="border-t border-gray-100 hover:bg-blue-50/30 align-top cursor-pointer">
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">
                      {new Date(c.called_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {c.person_name}
                      {c.is_vip ? <Star size={12} className="inline ml-1 text-[#FCB712] fill-[#FCB712]" /> : null}
                    </td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs">{c.phone_number}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{c.designation_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{c.district_name || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-[11px] font-semibold px-2 py-1 rounded-full border ${STATUS_PILL[c.status_name] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
                        {c.status_name || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs">{c.sentiment ? SENTIMENT_LABEL[c.sentiment] : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">{fmtDur(c.duration_seconds)}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs">
                      <div className="line-clamp-2">{c.remarks || <span className="text-gray-300">—</span>}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#164FA3]">
                        View / Edit
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && calls.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500 bg-gray-50">
            {calls.length} call{calls.length === 1 ? "" : "s"} logged
          </div>
        )}
      </div>

      {detail && (
        <CallDetailModal
          call={detail}
          statuses={statuses}
          onClose={() => setDetail(null)}
          onSaved={() => { setDetail(null); load(); }}
        />
      )}
    </div>
  );
}

// View the full details of a logged call and edit the contacted person's info.
function CallDetailModal({ call, statuses, onClose, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    person_name: call.person_name || "",
    phone_number: call.phone_number || "",
    address: call.address || "",
    status_id: call.status_id || "",
    sentiment: call.sentiment || "",
    remarks: call.remarks || "",
  });

  const statusName = statuses.find((s) => String(s.id) === String(form.status_id))?.name;

  async function save() {
    setSaving(true); setError("");
    try {
      const r = await fetch(`/api/calls/${call.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (r.ok) { onSaved(); return; }
      const d = await r.json().catch(() => ({}));
      setError(d.message || "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Call Details</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="text-xs text-gray-500">
          {new Date(call.called_at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          {call.duration_seconds != null && <> · {fmtDur(call.duration_seconds)} talk time</>}
        </div>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}

        {!editing ? (
          <div className="space-y-2 text-sm">
            <Detail label="Name" value={call.person_name} />
            <Detail label="Phone" value={call.phone_number} mono />
            <Detail label="Designation" value={call.designation_name} />
            <Detail label="Location" value={[call.district_name, call.assembly_name, call.zone_name].filter(Boolean).join(" / ")} icon={MapPin} />
            <Detail label="Address" value={call.address} />
            <Detail label="Status" value={call.status_name} />
            <Detail label="Sentiment" value={call.sentiment ? SENTIMENT_LABEL[call.sentiment] || call.sentiment : ""} />
            <Detail label="Follow-up" value={call.is_follow_up_required && call.follow_up_date ? call.follow_up_date.slice(0, 10) : ""} />
            <Detail label="Remarks" value={call.remarks} />
          </div>
        ) : (
          <div className="space-y-3">
            <input className={inp} placeholder="Name" value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} />
            <input className={`${inp} font-mono`} placeholder="Phone" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
            <input className={inp} placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <select className={inp} value={form.status_id} onChange={(e) => setForm({ ...form, status_id: e.target.value })}>
              <option value="">Status…</option>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className={inp} value={form.sentiment} onChange={(e) => setForm({ ...form, sentiment: e.target.value })}>
              <option value="">Sentiment — not set</option>
              <option value="positive">Positive</option>
              <option value="supporter">Supporter</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative</option>
              <option value="opponent">Opponent</option>
              {(statusName === "Phone Picked" || form.sentiment === "not_supporter") && <option value="not_supporter">Not a Supporter</option>}
            </select>
            <textarea className={inp} rows={3} placeholder="Remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {!editing ? (
            <button onClick={() => setEditing(true)} className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 text-white rounded-lg font-semibold">
              <Pencil size={14} /> Edit details
            </button>
          ) : (
            <>
              <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={save} disabled={saving || !form.person_name || !form.phone_number || !form.status_id} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">
                {saving ? "Saving…" : "Save changes"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, mono, icon: Icon }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-gray-400 uppercase text-[11px] tracking-wide pt-0.5">{label}</span>
      <span className={`flex-1 text-gray-900 ${mono ? "font-mono" : ""} flex items-center gap-1`}>
        {Icon && value ? <Icon size={13} className="text-gray-400" /> : null}
        {value || <span className="text-gray-300">—</span>}
      </span>
    </div>
  );
}
