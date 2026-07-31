"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { isOversight } from "@/lib/permissions";
import { CalendarDays, Plus, Loader2, X, Pencil, MapPin, Users, Search } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import ActionBar from "@/components/ActionBar";

const TYPES = { meeting: "Meeting", rally: "Rally", booth: "Booth Event", training: "Training", other: "Other" };
const STATUS = {
  scheduled: "bg-blue-100 text-blue-700", ongoing: "bg-amber-100 text-amber-700",
  completed: "bg-emerald-100 text-emerald-700", cancelled: "bg-gray-100 text-gray-400",
};
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d.slice(0, 10)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtTime(t) { return t ? t.slice(0, 5) : ""; }

export default function EventsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isOversight(session)) router.push("/dashboard");
  }, [status, session, router]);
  if (status !== "authenticated" || !isOversight(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body />;
}

function Body() {
  const [data, setData] = useState({ events: [], counts: {} });
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  async function load() {
    setLoading(true);
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (statusFilter) p.set("status", statusFilter);
    if (typeFilter) p.set("type", typeFilter);
    const r = await fetch(`/api/events?${p}`);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, typeFilter]);

  async function setStatus(id, s) {
    await fetch(`/api/events/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: s }) });
    load();
  }
  async function remove(ev) {
    if (!confirm(`Delete event "${ev.title}"?`)) return;
    await fetch(`/api/events/${ev.id}`, { method: "DELETE" });
    load();
  }

  const c = data.counts || {};
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={CalendarDays}
        title="Events & Mobilization"
        description="Plan meetings, rallies, booth events and trainings."
        breadcrumb={[{ label: "Dashboard", href: "/dashboard/admin" }, { label: "Task Management" }, { label: "Events" }]}
        actions={<ActionBar items={[{ key: "add", label: "Create Event", icon: Plus, variant: "primary", onClick: () => setShowAdd(true) }]} />}
      />

      <div className="grid grid-cols-3 gap-3">
        <SumCard label="Total" value={c.total || 0} accent />
        <SumCard label="Upcoming" value={c.upcoming || 0} />
        <SumCard label="Completed" value={c.completed || 0} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or venue" className="w-full pl-9 pr-3 h-9 rounded-lg border border-gray-200 text-sm outline-none" />
        </div>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All types</option>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="ongoing">Ongoing</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div>
        ) : data.events.length === 0 ? (
          <div className="p-12 text-center text-gray-400"><CalendarDays size={36} className="mx-auto text-gray-300 mb-3" />No events yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold text-gray-600 w-12">S.No.</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Event</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Type</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">When</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Venue</th>
                  <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e, i) => (
                  <tr key={e.id} className="border-t border-gray-100 hover:bg-gray-50 align-top">
                    <td className="px-4 py-3 text-gray-500 tabular-nums">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{e.title}</div>
                      {e.description && <div className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap line-clamp-2">{e.description}</div>}
                      {(e.invited > 0) && <div className="text-[11px] text-gray-400 mt-0.5 inline-flex items-center gap-1"><Users size={11} /> {e.attended}/{e.invited} attended</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{TYPES[e.type] || e.type}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{fmtDate(e.event_date)}{e.event_time ? ` • ${fmtTime(e.event_time)}` : ""}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{e.venue ? <span className="inline-flex items-center gap-1"><MapPin size={12} className="text-gray-400" />{e.venue}</span> : "—"}{e.district_name ? <div className="text-gray-400">{e.district_name}</div> : null}</td>
                    <td className="px-4 py-3">
                      <select value={e.status} onChange={(ev) => setStatus(e.id, ev.target.value)} className={`text-[11px] font-semibold px-2 py-1 rounded-full border-0 outline-none cursor-pointer ${STATUS[e.status]}`}>
                        <option value="scheduled">scheduled</option>
                        <option value="ongoing">ongoing</option>
                        <option value="completed">completed</option>
                        <option value="cancelled">cancelled</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setEditing(e)} title="Edit" className="p-1.5 text-gray-400 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg"><Pencil size={13} /></button>
                      <button onClick={() => remove(e)} title="Delete" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><X size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && <EventModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {editing && <EventModal editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
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

function EventModal({ onClose, onSaved, editing }) {
  const [form, setForm] = useState(editing ? {
    title: editing.title || "", type: editing.type || "meeting", description: editing.description || "",
    event_date: editing.event_date ? editing.event_date.slice(0, 10) : "", event_time: editing.event_time ? editing.event_time.slice(0, 5) : "",
    venue: editing.venue || "", district_id: editing.district_id || "", status: editing.status || "scheduled",
  } : { title: "", type: "meeting", description: "", event_date: "", event_time: "", venue: "", district_id: "", status: "scheduled" });
  const [districts, setDistricts] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || [])).catch(() => {}); }, []);

  async function save() {
    setSaving(true);
    const url = editing ? `/api/events/${editing.id}` : "/api/events";
    const method = editing ? "PUT" : "POST";
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) onSaved(); else setSaving(false);
  }
  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-3 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">{editing ? "Edit Event" : "Create Event"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <input className={inp} placeholder="Event title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <textarea className={inp} rows={2} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <select className={inp} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className={inp} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="scheduled">Scheduled</option><option value="ongoing">Ongoing</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
          </select>
          <input type="date" className={inp} value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} />
          <input type="time" className={inp} value={form.event_time} onChange={(e) => setForm({ ...form, event_time: e.target.value })} />
          <input className={inp} placeholder="Venue" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
          <select className={inp} value={form.district_id} onChange={(e) => setForm({ ...form, district_id: e.target.value })}>
            <option value="">District…</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving || !form.title || !form.event_date} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : (editing ? "Save" : "Create")}</button>
        </div>
      </div>
    </div>
  );
}
