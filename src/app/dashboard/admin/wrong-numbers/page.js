"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { isOversight, isAdmin } from "@/lib/permissions";
import { AlertCircle, Search, Loader2, RotateCcw, Pencil, Trash2, History, UserCog, Download, FileText, X } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import ActionBar from "@/components/ActionBar";

export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isOversight(session)) router.push("/dashboard");
  }, [status, session, router]);
  if (status !== "authenticated" || !isOversight(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body canDelete={isAdmin(session)} />;
}

const fmt = (d) => d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function Body({ canDelete }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [lokSabhaId, setLokSabhaId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [assemblyId, setAssemblyId] = useState("");
  const [caller, setCaller] = useState("");
  const [statusF, setStatusF] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [zones, setZones] = useState([]);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [callers, setCallers] = useState([]);
  const [reassign, setReassign] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [historyRow, setHistoryRow] = useState(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || []));
    fetch("/api/locations?type=lok_sabha").then((r) => r.json()).then((d) => setLokSabhas(d.locations || []));
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
    fetch("/api/locations?type=assembly").then((r) => r.json()).then((d) => setAssemblies(d.locations || []));
    fetch("/api/users").then((r) => r.ok ? r.json() : { users: [] }).then((d) => setCallers((d.users || []).filter((u) => ["caller", "user", "agent"].includes(u.role)))).catch(() => {});
  }, []);

  const qs = () => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (zoneId) p.set("zone_id", zoneId);
    if (lokSabhaId) p.set("lok_sabha_id", lokSabhaId);
    if (districtId) p.set("district_id", districtId);
    if (assemblyId) p.set("assembly_id", assemblyId);
    if (caller) p.set("caller", caller);
    if (statusF) p.set("status", statusF);
    if (from) p.set("date_from", from);
    if (to) p.set("date_to", to);
    return p;
  };

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/admin/wrong-numbers?${qs()}`);
    if (r.ok) setRows((await r.json()).wrong_numbers || []);
    setLoading(false);
  }
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, zoneId, lokSabhaId, districtId, assemblyId, caller, statusF, from, to]);

  async function restore(id) {
    if (!confirm("Restore this contact to the active calling queue?")) return;
    const r = await fetch(`/api/admin/wrong-numbers/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore" }) });
    if (r.ok) { setMsg("Contact restored to the calling queue."); load(); }
  }
  async function del(id) {
    if (!confirm("Permanently delete this record? This cannot be undone.")) return;
    const r = await fetch(`/api/admin/wrong-numbers/${id}`, { method: "DELETE" });
    if (r.ok) { setMsg("Record deleted."); load(); }
    else { const d = await r.json().catch(() => ({})); setMsg(d.message || "Delete failed."); }
  }

  const sel = "h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white";
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={AlertCircle}
        title="Wrong Numbers"
        description={`${rows.length} records marked wrong by callers. Restore, reassign, edit or export.`}
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Calling Management" }, { label: "Wrong Numbers" }]}
        actions={<ActionBar items={[
          { key: "xlsx", label: "Excel", icon: Download, href: `/api/admin/wrong-numbers/export/xlsx?${qs()}` },
          { key: "pdf", label: "PDF", icon: FileText, href: `/api/admin/wrong-numbers/export/pdf?${qs()}` },
        ]} />}
      />

      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 text-sm">{msg}</div>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-3 flex-wrap">
        <Search size={18} className="text-gray-400 ml-2" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or mobile" className="flex-1 min-w-[160px] outline-none text-sm py-2" />
        <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className={sel}><option value="">All zones</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
        <select value={lokSabhaId} onChange={(e) => setLokSabhaId(e.target.value)} className={sel}><option value="">All Lok Sabhas</option>{lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <select value={districtId} onChange={(e) => setDistrictId(e.target.value)} className={sel}><option value="">All districts</option>{districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)} className={sel}><option value="">All assemblies</option>{assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select value={caller} onChange={(e) => setCaller(e.target.value)} className={sel}><option value="">All callers</option>{callers.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}</select>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={sel}><option value="">Any status</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option></select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="Marked from" className={sel} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Marked to" className={sel} />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-gray-400"><AlertCircle size={36} className="mx-auto text-gray-300 mb-3" />No wrong numbers match.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-left">
                <tr>
                  {["Name", "Mobile", "Zone", "Lok Sabha", "District", "Assembly", "Block/Ward", "Address", "Caller", "Marked Wrong", "Last Call", "Attempts", "Status", "Remarks", "Actions"].map((h) => (
                    <th key={h} className="px-3 py-3 font-semibold text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-t border-gray-100 hover:bg-red-50/20 align-top">
                    <td className="px-3 py-3 font-medium text-gray-900">{c.person_name}</td>
                    <td className="px-3 py-3 font-mono text-xs text-gray-700">{c.phone_number}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.zone_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.lok_sabha_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.district_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.assembly_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{c.ward_name || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-600 max-w-[160px] truncate" title={c.address || ""}>{c.address || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-700">{c.caller_name || <span className="text-gray-300">Unassigned</span>}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{fmt(c.marked_wrong_date)}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{fmt(c.last_call_date)}</td>
                    <td className="px-3 py-3 text-center font-bold text-gray-700">{c.attempts}</td>
                    <td className="px-3 py-3"><span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-600 border border-gray-200">Wrong Number</span></td>
                    <td className="px-3 py-3 text-xs text-gray-600 max-w-[160px] truncate" title={c.last_remarks || ""}>{c.last_remarks || "—"}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        <IconBtn title="Restore to queue" onClick={() => restore(c.id)} className="text-emerald-600 hover:bg-emerald-50"><RotateCcw size={15} /></IconBtn>
                        <IconBtn title="Edit contact" onClick={() => setEditRow(c)} className="text-[#164FA3] hover:bg-blue-50"><Pencil size={15} /></IconBtn>
                        <IconBtn title="Reassign" onClick={() => setReassign(c)} className="text-amber-600 hover:bg-amber-50"><UserCog size={15} /></IconBtn>
                        <IconBtn title="Call history" onClick={() => setHistoryRow(c)} className="text-gray-600 hover:bg-gray-100"><History size={15} /></IconBtn>
                        {canDelete && <IconBtn title="Delete" onClick={() => del(c.id)} className="text-red-600 hover:bg-red-50"><Trash2 size={15} /></IconBtn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reassign && <ReassignModal row={reassign} callers={callers} onClose={() => setReassign(null)} onSaved={() => { setReassign(null); setMsg("Contact reassigned."); load(); }} />}
      {editRow && <EditModal row={editRow} onClose={() => setEditRow(null)} onSaved={() => { setEditRow(null); setMsg("Contact updated."); load(); }} />}
      {historyRow && <HistoryModal row={historyRow} onClose={() => setHistoryRow(null)} />}
    </div>
  );
}

function IconBtn({ title, onClick, className, children }) {
  return <button title={title} onClick={onClick} className={`p-1.5 rounded-lg ${className}`}>{children}</button>;
}

const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="text-xl font-bold text-gray-900">{title}</h2><button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button></div>
        {children}
      </div>
    </div>
  );
}

function ReassignModal({ row, callers, onClose, onSaved }) {
  const [userId, setUserId] = useState(row.assigned_to_user_id || "");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!userId) return;
    setSaving(true);
    const r = await fetch(`/api/admin/wrong-numbers/${row.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reassign", user_id: userId }) });
    if (r.ok) onSaved(); else setSaving(false);
  }
  return (
    <Modal title={`Reassign ${row.person_name}`} onClose={onClose}>
      <p className="text-sm text-gray-500">Choose the caller to assign this contact to. (Reassigning does not restore it to the queue — use Restore for that.)</p>
      <select className={inp} value={userId} onChange={(e) => setUserId(e.target.value)}>
        <option value="">Select caller…</option>
        {callers.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
      </select>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
        <button onClick={save} disabled={saving || !userId} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : "Reassign"}</button>
      </div>
    </Modal>
  );
}

function EditModal({ row, onClose, onSaved }) {
  const [form, setForm] = useState({ person_name: row.person_name || "", phone_number: row.phone_number || "", address: row.address || "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true); setError("");
    const r = await fetch(`/api/contacts/${row.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) onSaved(); else { const d = await r.json().catch(() => ({})); setError(d.message || "Failed to save."); setSaving(false); }
  }
  return (
    <Modal title="Edit Contact" onClose={onClose}>
      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
      <input className={inp} placeholder="Name" value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} />
      <input className={`${inp} font-mono`} placeholder="Mobile" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
      <input className={inp} placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
        <button onClick={save} disabled={saving || !form.person_name || !form.phone_number} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

function HistoryModal({ row, onClose }) {
  const [history, setHistory] = useState(null);
  useEffect(() => {
    fetch(`/api/contacts/${row.id}/history`).then((r) => r.json()).then((d) => setHistory(d.history || [])).catch(() => setHistory([]));
  }, [row.id]);
  return (
    <Modal title={`Call history — ${row.person_name}`} onClose={onClose}>
      {history === null ? <div className="text-gray-400 text-sm"><Loader2 className="inline animate-spin" /></div>
        : history.length === 0 ? <div className="text-gray-400 text-sm">No calls logged.</div>
        : (
          <ul className="divide-y divide-gray-100">
            {history.map((h) => (
              <li key={h.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{new Date(h.called_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="text-xs text-gray-500">{h.agent_name} · {h.status_name}</span>
                </div>
                {h.remarks && <div className="text-gray-600 italic">"{h.remarks}"</div>}
                {h.sentiment && <div className="text-xs text-gray-400 mt-0.5">{h.sentiment}</div>}
              </li>
            ))}
          </ul>
        )}
    </Modal>
  );
}
