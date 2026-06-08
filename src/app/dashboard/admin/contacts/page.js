"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Upload, Plus, Search, UserPlus, Loader2, CheckCircle2, Pencil } from "lucide-react";
import { isAdmin, normalizeRole, ROLES } from "@/lib/permissions";

export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isAdmin(session)) router.push("/dashboard");
  }, [status, session, router]);

  if (status !== "authenticated" || !isAdmin(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body />;
}

function Body() {
  const [contacts, setContacts] = useState([]);
  const [users, setUsers] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("pending"); // all | pending | done | assigned | pool
  const [districtId, setDistrictId] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [bulkCaller, setBulkCaller] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const fileRef = useRef(null);
  const excelRef = useRef(null);

  useEffect(() => { load(); }, [filter, districtId]);
  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then((d) => setUsers((d.users || []).filter((u) => normalizeRole(u.role) === ROLES.CALLER)));
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
  }, []);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    if (search) params.set("search", search);
    if (districtId) params.set("district_id", districtId);
    const r = await fetch(`/api/contacts?${params}`);
    if (r.ok) setContacts((await r.json()).contacts || []);
    setLoading(false);
  }

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Bulk-assign ALL contacts matching the current filters to the chosen caller.
  async function bulkAssign() {
    setMessage(""); setError("");
    const callerName = bulkCaller ? (users.find((u) => String(u.id) === String(bulkCaller))?.username || "caller") : "the pool";
    if (!confirm(`Assign ALL ${filter !== "all" ? filter + " " : ""}contacts${districtId ? " in this district" : ""}${search ? ` matching "${search}"` : ""} to ${callerName}? (Already-called contacts are skipped.)`)) return;
    setBulkBusy(true);
    try {
      const r = await fetch("/api/contacts/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigned_to_user_id: bulkCaller || null,
          status: filter,
          district_id: districtId || undefined,
          search: search || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.message || "Bulk assign failed"); return; }
      setMessage(`Assigned ${d.assigned} contacts to ${callerName}.`);
      load();
    } catch {
      setError("Bulk assign failed — network error.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function uploadCsv(file) {
    setMessage(""); setError("");
    const text = await file.text();
    const r = await fetch("/api/contacts/upload-csv", {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: text,
    });
    const data = await r.json();
    if (!r.ok) { setError(data.message || "Upload failed"); return; }
    setMessage(`Uploaded ${data.inserted} new contacts (${data.duplicates} duplicates skipped of ${data.total_rows} rows).`);
    load();
  }

  // Import members from an Excel/CSV file (e.g. MEMBER LIST.xlsx).
  // Adds each member to Workers AND (if they have a phone) to Contacts.
  async function importExcel(file) {
    setMessage(""); setError("");
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/workers/import-excel", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) { setError(d.message || "Import failed"); return; }
      let msg = `Contacts: ${d.contacts_inserted} new, ${d.contacts_updated} updated`;
      if (d.contacts_skipped_no_phone) msg += ` (${d.contacts_skipped_no_phone} members had no phone)`;
      msg += `. Members: ${d.workers_inserted} new, ${d.workers_updated} updated.`;
      if (d.unmatched_assemblies?.length) msg += ` Unmatched assemblies: ${d.unmatched_assemblies.slice(0, 5).join(", ")}${d.unmatched_assemblies.length > 5 ? "…" : ""}.`;
      setMessage(msg);
      load();
    } catch {
      setError("Import failed — file too large or network error.");
    } finally {
      setImporting(false);
      if (excelRef.current) excelRef.current.value = "";
    }
  }

  async function assign(contactId, userId) {
    await fetch(`/api/contacts/${contactId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigned_to_user_id: userId || null }),
    });
    load();
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Contacts</h1>
          <p className="text-gray-500 mt-2 font-medium">Voter list for the calling team. Upload CSV or add manually.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => excelRef.current?.click()} disabled={importing} className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-sm">
            {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {importing ? "Importing…" : "Import Excel"}
          </button>
          <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
                 onChange={(e) => e.target.files?.[0] && importExcel(e.target.files[0])} />
          <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium shadow-sm">
            <Upload size={16} /> Upload CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                 onChange={(e) => e.target.files?.[0] && uploadCsv(e.target.files[0])} />
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-md">
            <Plus size={16} /> Add Contact
          </button>
        </div>
      </div>

      {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 flex items-center gap-2"><CheckCircle2 size={16} />{message}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3">{error}</div>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-3 flex-wrap">
        <Search size={18} className="text-gray-400 ml-2" />
        <input type="text" placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 min-w-[180px] outline-none text-sm py-2" />
        <select value={districtId} onChange={(e) => setDistrictId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All districts</option>
          {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="flex gap-1">
          {["all", "pending", "done", "assigned", "pool"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase ${filter === f ? "bg-[#164FA3] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{f}</button>
          ))}
        </div>
      </div>

      {/* Bulk assign bar — assign ALL contacts matching the filters above to one caller */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 flex items-center gap-3 flex-wrap">
        <UserPlus size={18} className="text-[#164FA3] ml-1" />
        <span className="text-sm text-gray-700 font-medium">Bulk assign all matching contacts to:</span>
        <select value={bulkCaller} onChange={(e) => setBulkCaller(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">— pool (unassign) —</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
        </select>
        <button onClick={bulkAssign} disabled={bulkBusy} className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-sm">
          {bulkBusy ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
          {bulkBusy ? "Assigning…" : "Assign all matching"}
        </button>
        <span className="text-xs text-gray-500">Showing {contacts.length}{contacts.length >= 500 ? "+" : ""} of the matching set. Already-called (Done) contacts are never reassigned.</span>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-gray-400">Loading…</div>
        ) : contacts.length === 0 ? (
          <div className="p-8 text-gray-400">No contacts match.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Phone</th>
                <th className="px-4 py-3 font-semibold text-gray-600">District</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Assigned To</th>
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Edit</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.person_name}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{c.phone_number}</td>
                  <td className="px-4 py-3 text-gray-600">{c.district_name || "—"}</td>
                  <td className="px-4 py-3">
                    {c.is_completed ? (
                      <span className="text-emerald-700 font-medium text-xs">Done</span>
                    ) : c.locked_by_user_id ? (
                      <span className="text-amber-600 font-medium text-xs">In progress</span>
                    ) : (
                      <span className="text-gray-500 text-xs">Pending</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={c.assigned_to_user_id || ""}
                      onChange={(e) => assign(c.id, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                    >
                      <option value="">— pool —</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(c)} className="inline-flex items-center gap-1 text-xs text-[#164FA3] hover:bg-blue-50 px-2 py-1 rounded-lg font-medium">
                      <Pencil size={14} /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && <AddContactModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {editing && <EditContactModal contact={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function EditContactModal({ contact, onClose, onSaved }) {
  const [form, setForm] = useState({
    person_name: contact.person_name || "",
    phone_number: contact.phone_number || "",
    address: contact.address || "",
    district_id: contact.district_id || "",
  });
  const [districts, setDistricts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
  }, []);

  async function save() {
    setSaving(true); setError("");
    const r = await fetch(`/api/contacts/${contact.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person_name: form.person_name,
        phone_number: form.phone_number,
        address: form.address,
        district_id: form.district_id || null,
      }),
    });
    const data = await r.json();
    if (!r.ok) { setError(data.message || "Save failed"); setSaving(false); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-xl font-bold text-gray-900">Edit Contact</h2>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
        <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Person name *" value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} />
        <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Phone number *" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
        <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" value={form.district_id} onChange={(e) => setForm({ ...form, district_id: e.target.value })}>
          <option value="">No district</option>
          {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving || !form.person_name || !form.phone_number} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddContactModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ person_name: "", phone_number: "", address: "", district_id: "" });
  const [districts, setDistricts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
  }, []);

  async function save() {
    setSaving(true); setError("");
    const r = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await r.json();
    if (!r.ok) { setError(data.message || "Save failed"); setSaving(false); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-xl font-bold text-gray-900">Add Contact</h2>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
        <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Person name *" value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} />
        <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Phone number *" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
        <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" value={form.district_id} onChange={(e) => setForm({ ...form, district_id: e.target.value })}>
          <option value="">No district</option>
          {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving || !form.person_name || !form.phone_number} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
