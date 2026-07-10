"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Upload, Plus, Search, UserPlus, UserMinus, Loader2, CheckCircle2, Pencil, Trash2, ClipboardList } from "lucide-react";
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
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState([]);
  const [zones, setZones] = useState([]);
  const [zoneId, setZoneId] = useState("");
  const [districts, setDistricts] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("pending"); // all | pending | done | assigned | pool
  const [districtId, setDistrictId] = useState("");
  const [assemblies, setAssemblies] = useState([]);
  const [assemblyId, setAssemblyId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [taskFor, setTaskFor] = useState(null); // contact to create a task for
  const [importing, setImporting] = useState(false);
  const [bulkCallers, setBulkCallers] = useState([]); // selected caller ids
  const [teams, setTeams] = useState([]);
  const [bulkTeam, setBulkTeam] = useState("");
  const [bulkMode, setBulkMode] = useState("even"); // even | perCaller
  const [perCaller, setPerCaller] = useState(100);
  const [bulkBusy, setBulkBusy] = useState(false);
  const fileRef = useRef(null);
  const excelRef = useRef(null);

  useEffect(() => { load(); }, [filter, zoneId, districtId, assemblyId, designationId, assignedTo]);
  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then((d) => setUsers((d.users || []).filter((u) => normalizeRole(u.role) === ROLES.CALLER)));
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || []));
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || []));
    fetch("/api/teams").then((r) => r.json()).then((d) => setTeams(d.teams || [])).catch(() => {});
  }, []);

  // Selecting a team pre-selects all its caller members for distribution.
  async function loadTeamCallers(teamId) {
    setBulkTeam(teamId);
    if (!teamId) return;
    const r = await fetch(`/api/teams/${teamId}`);
    if (!r.ok) return;
    const d = await r.json();
    const callerIds = users.map((u) => u.id);
    const memberCallerIds = (d.members || [])
      .filter((m) => m.member_type === "user" && callerIds.includes(m.user_id))
      .map((m) => m.user_id);
    setBulkCallers(memberCallerIds);
    if (memberCallerIds.length === 0) setError("This team has no caller accounts as members. Add users to the team first.");
    else setError("");
  }

  // Assembly options follow the selected district.
  useEffect(() => {
    if (districtId) {
      fetch(`/api/locations?parent_id=${districtId}`).then((r) => r.json()).then((d) => setAssemblies(d.locations || []));
    } else setAssemblies([]);
    setAssemblyId("");
  }, [districtId]);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter === "duplicates") params.set("duplicates", "1");
    else if (filter !== "all") params.set("status", filter);
    if (search) params.set("search", search);
    if (zoneId) params.set("zone_id", zoneId);
    if (districtId) params.set("district_id", districtId);
    if (assemblyId) params.set("assembly_id", assemblyId);
    if (designationId) params.set("designation_id", designationId);
    if (assignedTo) params.set("assigned_to", assignedTo);
    const r = await fetch(`/api/contacts?${params}`);
    if (r.ok) { const d = await r.json(); setContacts(d.contacts || []); setTotal(d.total ?? (d.contacts || []).length); }
    setLoading(false);
  }

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [search]);

  function toggleBulkCaller(id) {
    setBulkCallers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  // Distribute matching contacts across the selected callers (even split or N each).
  async function bulkDistribute() {
    setMessage(""); setError("");
    if (bulkCallers.length === 0) { setError("Select at least one caller to distribute to."); return; }
    const names = bulkCallers.map((id) => users.find((u) => u.id === id)?.username).filter(Boolean).join(", ");
    const desc = bulkMode === "perCaller"
      ? `${perCaller} contacts each to ${bulkCallers.length} caller(s): ${names}`
      : `evenly across ${bulkCallers.length} caller(s): ${names}`;
    if (!confirm(`Distribute ${filter !== "all" ? filter + " " : ""}contacts${districtId ? " in this district" : ""} — ${desc}? (Already-called contacts are skipped.)`)) return;
    setBulkBusy(true);
    try {
      const r = await fetch("/api/contacts/bulk-distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caller_ids: bulkCallers,
          mode: bulkMode,
          per_caller: bulkMode === "perCaller" ? Number(perCaller) : undefined,
          status: filter,
          district_id: districtId || undefined,
          search: search || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.message || "Distribute failed"); return; }
      const breakdown = Object.entries(d.per_caller_counts || {}).map(([u, n]) => `${u}: ${n}`).join(", ");
      setMessage(`Distributed ${d.assigned} contacts — ${breakdown || "none matched"}.`);
      load();
    } catch {
      setError("Distribute failed — network error.");
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

  // Recall contacts from callers' workspaces — back to the pool, nothing deleted.
  async function bulkRecall() {
    setMessage(""); setError("");
    const target = bulkCallers.length > 0
      ? `${bulkCallers.length} selected caller(s)`
      : "ALL callers";
    if (!confirm(`Remove assigned contacts from ${target}? Contacts stay in the database and return to the pool; completed calls are not touched.`)) return;
    setBulkBusy(true);
    try {
      const r = await fetch("/api/contacts/bulk-unassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caller_ids: bulkCallers }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.message || "Recall failed"); return; }
      setMessage(`Removed ${d.unassigned} contact(s) from ${target} — they are back in the pool.`);
      load();
    } catch {
      setError("Recall failed — network error.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function removeContact(c) {
    if (!confirm(`Delete contact "${c.person_name}" (${c.phone_number})? Their call history stays, but the contact is removed from the calling list.`)) return;
    const r = await fetch(`/api/contacts/${c.id}`, { method: "DELETE" });
    if (r.ok) { setMessage(`Deleted ${c.person_name}.`); load(); }
    else { const d = await r.json().catch(() => ({})); setError(d.message || "Delete failed"); }
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
          <p className="text-gray-500 mt-2 font-medium">
            <span className="font-bold text-[#164FA3]">{total.toLocaleString()}</span>{" "}
            {filter === "duplicates" ? "possible duplicate" : filter !== "all" ? filter : ""} contact{total === 1 ? "" : "s"}{districtId ? " in this district" : ""}.
            {filter === "duplicates" ? " Same phone number saved in different formats — review and delete the extras." : " Calling list for the team."}
          </p>
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
        <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All zones</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <select value={districtId} onChange={(e) => setDistrictId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All districts</option>
          {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)} disabled={!districtId} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white disabled:opacity-50">
          <option value="">All assemblies</option>
          {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={designationId} onChange={(e) => setDesignationId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All designations</option>
          {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">Any caller</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
        </select>
        <div className="flex gap-1 flex-wrap">
          {["all", "pending", "done", "assigned", "pool", "duplicates"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase ${filter === f ? (f === "duplicates" ? "bg-amber-500 text-white" : "bg-[#164FA3] text-white") : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{f}</button>
          ))}
        </div>
      </div>

      {/* Bulk distribute — share matching contacts across several callers (hidden in duplicates view) */}
      {filter !== "duplicates" && (
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <UserPlus size={18} className="text-[#164FA3]" />
          <span className="text-sm text-gray-800 font-semibold">
            Distribute the {total.toLocaleString()} {filter !== "all" ? filter + " " : ""}contacts
            {districtId ? ` in ${districts.find((d) => String(d.id) === String(districtId))?.name || "this district"}` : ""} across callers
          </span>
        </div>

        {/* team shortcut — selects all caller accounts in the team */}
        {teams.length > 0 && (
          <div className="flex items-center gap-2">
            <select value={bulkTeam} onChange={(e) => loadTeamCallers(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
              <option value="">Pick callers from a team…</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <span className="text-xs text-gray-500">or pick callers individually below</span>
          </div>
        )}

        {/* caller multi-select */}
        <div className="flex flex-wrap gap-2">
          {users.length === 0 && <span className="text-xs text-gray-500">No callers exist yet. Create caller users first.</span>}
          {users.map((u) => {
            const on = bulkCallers.includes(u.id);
            return (
              <button key={u.id} onClick={() => toggleBulkCaller(u.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${on ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200 hover:border-[#164FA3]"}`}>
                {on ? "✓ " : ""}{u.username}
              </button>
            );
          })}
          {users.length > 1 && (
            <button onClick={() => setBulkCallers(bulkCallers.length === users.length ? [] : users.map((u) => u.id))}
              className="px-3 py-1.5 rounded-full text-xs font-medium text-[#164FA3] underline">
              {bulkCallers.length === users.length ? "clear all" : "select all"}
            </button>
          )}
        </div>

        {/* mode + action */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1">
            <button onClick={() => setBulkMode("even")} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${bulkMode === "even" ? "bg-[#164FA3] text-white" : "text-gray-600"}`}>Split evenly</button>
            <button onClick={() => setBulkMode("perCaller")} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${bulkMode === "perCaller" ? "bg-[#164FA3] text-white" : "text-gray-600"}`}>N per caller</button>
          </div>
          {bulkMode === "perCaller" && (
            <input type="number" min="1" value={perCaller} onChange={(e) => setPerCaller(e.target.value)} className="h-9 w-24 px-3 rounded-lg border border-gray-200 text-sm" placeholder="per caller" />
          )}
          <button onClick={bulkDistribute} disabled={bulkBusy || bulkCallers.length === 0} className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-sm">
            {bulkBusy ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
            {bulkBusy ? "Distributing…" : bulkMode === "even"
              ? `Split evenly to ${bulkCallers.length || 0} caller(s)`
              : `Give ${perCaller || 0} each to ${bulkCallers.length || 0} caller(s)`}
          </button>
          <span className="text-xs text-gray-500">Already-called (Done) contacts are never reassigned.</span>
        </div>

        {/* Recall — pull assigned contacts back out of caller workspaces (no deletion) */}
        <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-blue-100">
          <button onClick={bulkRecall} disabled={bulkBusy} className="inline-flex items-center gap-2 bg-white border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 px-4 py-2 rounded-xl text-sm font-semibold">
            <UserMinus size={16} />
            {bulkCallers.length > 0 ? `Remove contacts from ${bulkCallers.length} selected caller(s)` : "Remove contacts from ALL callers"}
          </button>
          <span className="text-xs text-gray-500">Contacts go back to the pool — nothing is deleted from the database.</span>
        </div>
      </div>
      )}

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
                <th className="px-4 py-3 font-semibold text-gray-600">Designation</th>
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
                  <td className="px-4 py-3 text-gray-600">{c.designation_name || "—"}</td>
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
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setTaskFor(c)} className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded-lg font-medium">
                      <ClipboardList size={14} /> Task
                    </button>
                    <button onClick={() => setEditing(c)} className="inline-flex items-center gap-1 text-xs text-[#164FA3] hover:bg-blue-50 px-2 py-1 rounded-lg font-medium">
                      <Pencil size={14} /> Edit
                    </button>
                    <button onClick={() => removeContact(c)} className="inline-flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg font-medium">
                      <Trash2 size={14} /> Delete
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
      {taskFor && <ContactTaskModal contact={taskFor} users={users} onClose={() => setTaskFor(null)} onSaved={() => { setTaskFor(null); setMessage(`Task assigned for ${taskFor.person_name}.`); }} />}
    </div>
  );
}

// Assign a task pinned to a contact — the telecaller sees it in the workspace
// while calling that person and can update its status there.
function ContactTaskModal({ contact, users, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "medium",
    deadline: "",
    assigned_to_user_id: contact.assigned_to_user_id || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true); setError("");
    const r = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, contact_id: contact.id, district_id: contact.district_id || null }),
    });
    if (r.ok) { onSaved(); return; }
    const d = await r.json().catch(() => ({}));
    setError(d.message || "Failed to create task");
    setSaving(false);
  }

  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-3">
        <h2 className="text-xl font-bold text-gray-900">Task for {contact.person_name}</h2>
        <p className="text-xs text-gray-500 -mt-2">{contact.phone_number} · shown to the caller during the call</p>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
        <input className={inp} placeholder="Task title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <textarea className={inp} rows={2} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <select className={inp} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
          <input type="date" className={inp} value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
        </div>
        <select className={inp} value={form.assigned_to_user_id} onChange={(e) => setForm({ ...form, assigned_to_user_id: e.target.value })}>
          <option value="">Assign to caller (optional)…</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
        </select>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving || !form.title} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : "Assign Task"}</button>
        </div>
      </div>
    </div>
  );
}

function EditContactModal({ contact, onClose, onSaved }) {
  const [form, setForm] = useState({
    person_name: contact.person_name || "",
    phone_number: contact.phone_number || "",
    address: contact.address || "",
    designation_id: contact.designation_id || "",
    zone_id: contact.zone_id || "",
    district_id: contact.district_id || "",
    assembly_id: contact.assembly_id || "",
    ward_id: contact.ward_id || "",
    booth_id: contact.booth_id || "",
  });
  const [zones, setZones] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [wards, setWards] = useState([]);
  const [booths, setBooths] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || []));
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || []));
  }, []);

  // Cascade the geography: assembly ← district, ward ← assembly, booth ← ward.
  useEffect(() => {
    if (!form.district_id) { setAssemblies([]); return; }
    fetch(`/api/locations?parent_id=${form.district_id}`).then((r) => r.json()).then((d) => setAssemblies(d.locations || []));
  }, [form.district_id]);
  useEffect(() => {
    if (!form.assembly_id) { setWards([]); return; }
    fetch(`/api/locations?parent_id=${form.assembly_id}`).then((r) => r.json()).then((d) => setWards(d.locations || []));
  }, [form.assembly_id]);
  useEffect(() => {
    if (!form.ward_id) { setBooths([]); return; }
    fetch(`/api/locations?parent_id=${form.ward_id}`).then((r) => r.json()).then((d) => setBooths(d.locations || []));
  }, [form.ward_id]);

  async function save() {
    setSaving(true); setError("");
    const r = await fetch(`/api/contacts/${contact.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person_name: form.person_name,
        phone_number: form.phone_number,
        address: form.address,
        designation_id: form.designation_id || null,
        zone_id: form.zone_id || null,
        district_id: form.district_id || null,
        assembly_id: form.assembly_id || null,
        ward_id: form.ward_id || null,
        booth_id: form.booth_id || null,
      }),
    });
    const data = await r.json();
    if (!r.ok) { setError(data.message || "Save failed"); setSaving(false); return; }
    onSaved();
  }

  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-gray-900">Edit Contact</h2>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
        <input className={inp} placeholder="Person name *" value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} />
        <input className={inp} placeholder="Phone number *" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
        <input className={inp} placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <select className={inp} value={form.designation_id} onChange={(e) => setForm({ ...form, designation_id: e.target.value })}>
          <option value="">No designation</option>
          {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <select className={inp} value={form.zone_id} onChange={(e) => setForm({ ...form, zone_id: e.target.value })}>
            <option value="">No zone</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          <select className={inp} value={form.district_id} onChange={(e) => setForm({ ...form, district_id: e.target.value, assembly_id: "", ward_id: "", booth_id: "" })}>
            <option value="">No district</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className={inp} value={form.assembly_id} disabled={!form.district_id} onChange={(e) => setForm({ ...form, assembly_id: e.target.value, ward_id: "", booth_id: "" })}>
            <option value="">{form.district_id ? "No assembly" : "Pick district"}</option>
            {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className={inp} value={form.ward_id} disabled={!form.assembly_id} onChange={(e) => setForm({ ...form, ward_id: e.target.value, booth_id: "" })}>
            <option value="">{form.assembly_id ? "No ward" : "Pick assembly"}</option>
            {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select className={inp} value={form.booth_id} disabled={!form.ward_id} onChange={(e) => setForm({ ...form, booth_id: e.target.value })}>
            <option value="">{form.ward_id ? "No booth" : "Pick ward"}</option>
            {booths.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
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
  const [form, setForm] = useState({ person_name: "", phone_number: "", address: "", designation_id: "", district_id: "" });
  const [districts, setDistricts] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || []));
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
        <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" value={form.designation_id} onChange={(e) => setForm({ ...form, designation_id: e.target.value })}>
          <option value="">No designation</option>
          {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
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
