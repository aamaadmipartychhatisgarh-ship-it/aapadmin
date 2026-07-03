"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isAdmin, isOversight } from "@/lib/permissions";
import { Network, Plus, Users, Loader2, ChevronRight, Trophy, Pencil, Search } from "lucide-react";

const LEVELS = [
  { key: "state", label: "State" }, { key: "zone", label: "Zone" },
  { key: "lok_sabha", label: "Lok Sabha" }, { key: "district", label: "District" },
  { key: "assembly", label: "Assembly" }, { key: "ward", label: "Ward" },
  { key: "mandal", label: "Mandal" }, { key: "booth", label: "Booth" },
];
const LEVEL_COLOR = {
  state: "bg-[#164FA3] text-white", zone: "bg-purple-100 text-purple-800",
  lok_sabha: "bg-blue-100 text-blue-800", district: "bg-emerald-100 text-emerald-800",
  assembly: "bg-amber-100 text-amber-800", ward: "bg-pink-100 text-pink-800",
  mandal: "bg-cyan-100 text-cyan-800", booth: "bg-gray-100 text-gray-700",
};

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
  return <Body canEdit={isAdmin(session)} />;
}

function Body({ canEdit }) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [locations, setLocations] = useState([]);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("");

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const r = await fetch("/api/teams");
    if (r.ok) setTeams((await r.json()).teams || []);
    setLoading(false);
  }

  // Client-side filters — the whole team list is already loaded.
  const visible = teams.filter((t) =>
    (!search || t.name.toLowerCase().includes(search.trim().toLowerCase())) &&
    (!levelFilter || t.level === levelFilter)
  );
  const grouped = LEVELS.map((lv) => ({ ...lv, items: visible.filter((t) => t.level === lv.key) })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Teams</h1>
          <p className="text-gray-500 mt-2 font-medium">{teams.length} teams across the organization hierarchy.</p>
        </div>
        {canEdit && (
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-md">
            <Plus size={16} /> Create Team
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex items-center gap-3 flex-wrap">
        <Search size={18} className="text-gray-400 ml-2" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search team name" className="flex-1 min-w-[180px] outline-none text-sm py-2" />
        <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">All levels</option>
          {LEVELS.map((lv) => <option key={lv.key} value={lv.key}>{lv.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>
      ) : grouped.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-gray-100 text-center text-gray-400">
          <Network size={36} className="mx-auto text-gray-300 mb-3" />No teams yet.
        </div>
      ) : (
        grouped.map((g) => (
          <div key={g.key}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-xs font-bold uppercase px-2.5 py-1 rounded-full ${LEVEL_COLOR[g.key]}`}>{g.label}</span>
              <span className="text-sm text-gray-400">{g.items.length} team{g.items.length === 1 ? "" : "s"}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {g.items.map((t) => (
                <div key={t.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow group relative">
                  {canEdit && (
                    <button onClick={(e) => { e.preventDefault(); setEditing(t); }} title="Edit team"
                            className="absolute top-3 right-3 p-1.5 text-gray-300 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg">
                      <Pencil size={14} />
                    </button>
                  )}
                  <Link href={`/dashboard/admin/teams/${t.id}`} className="block">
                    <div className="flex items-start justify-between pr-8">
                      <h3 className="font-bold text-gray-900 group-hover:text-[#164FA3]">{t.name}</h3>
                    </div>
                    {t.location_name && <p className="text-xs text-gray-500 mt-1">{t.location_name}</p>}
                    <div className="flex items-center gap-4 mt-4 text-sm">
                      <span className="flex items-center gap-1 text-gray-600"><Users size={14} /> {t.member_count} members</span>
                      <span className="flex items-center gap-1 text-gray-600"><Trophy size={14} className="text-[#FCB712]" /> {t.avg_activity} avg</span>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {showAdd && <AddTeamModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {editing && <AddTeamModal editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function AddTeamModal({ onClose, onSaved, editing }) {
  // When `editing` is set, the modal pre-fills and saves via PUT to /api/teams/[id].
  const [form, setForm] = useState(editing ? {
    name: editing.name || "",
    level: editing.level || "district",
    location_id: editing.location_id || "",
  } : { name: "", level: "district", location_id: "" });
  const [locations, setLocations] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const type = form.level === "lok_sabha" ? "lok_sabha" : form.level;
    if (["zone", "lok_sabha", "district", "assembly"].includes(form.level)) {
      fetch(`/api/locations?type=${type}`).then((r) => r.json()).then((d) => setLocations(d.locations || []));
    } else setLocations([]);
  }, [form.level]);

  async function save() {
    setSaving(true);
    const url = editing ? `/api/teams/${editing.id}` : "/api/teams";
    const method = editing ? "PUT" : "POST";
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) onSaved(); else setSaving(false);
  }
  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-3">
        <h2 className="text-xl font-bold text-gray-900">{editing ? "Edit Team" : "Create Team"}</h2>
        <input className={inp} placeholder="Team name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select className={inp} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value, location_id: "" })}>
          {LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
        </select>
        {locations.length > 0 && (
          <select className={inp} value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
            <option value="">Link to location (optional)</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving || !form.name} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : (editing ? "Save" : "Create")}</button>
        </div>
      </div>
    </div>
  );
}
