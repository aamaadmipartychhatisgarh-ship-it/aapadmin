"use client";

import { useEffect, useState, use } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isAdmin, isOversight } from "@/lib/permissions";
import { ArrowLeft, Users, Trophy, Plus, X, Loader2, Trash2 } from "lucide-react";

export default function Page({ params }) {
  const { id } = use(params);
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (status === "authenticated" && !isOversight(session)) router.push("/dashboard");
  }, [status, session, router]);
  if (status !== "authenticated" || !isOversight(session)) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }
  return <Body id={id} canEdit={isAdmin(session)} router={router} />;
}

function Body({ id, canEdit, router }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => { load(); }, [id]);
  async function load() {
    setLoading(true);
    const r = await fetch(`/api/teams/${id}`);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }
  async function removeMember(workerId) {
    await fetch(`/api/teams/${id}/members?worker_id=${workerId}`, { method: "DELETE" });
    load();
  }
  async function delTeam() {
    if (!confirm("Delete this team?")) return;
    await fetch(`/api/teams/${id}`, { method: "DELETE" });
    router.push("/dashboard/admin/teams");
  }

  if (loading || !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  const { team, members } = data;
  const avg = members.length ? Math.round(members.reduce((a, m) => a + m.activity_score, 0) / members.length) : 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl">
      <Link href="/dashboard/admin/teams" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#164FA3]"><ArrowLeft size={16} /> Back to teams</Link>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{team.name}</h1>
            <p className="text-gray-500 mt-1">
              <span className="uppercase text-xs font-bold">{team.level}</span>
              {team.location_name && <> · {team.location_name}</>}
              {team.leader_name && <> · Led by {team.leader_name}</>}
            </p>
          </div>
          {canEdit && (
            <button onClick={delTeam} className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"><Trash2 size={16} /></button>
          )}
        </div>
        <div className="flex gap-6 mt-5">
          <Stat icon={Users} label="Members" value={members.length} />
          <Stat icon={Trophy} label="Avg activity" value={avg} />
          <Stat icon={Users} label="Active" value={members.filter((m) => m.status === "active").length} />
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-900 flex items-center gap-2"><Users size={18} className="text-[#164FA3]" /> Members</h2>
          {canEdit && <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1 text-sm bg-[#164FA3] text-white px-3 py-1.5 rounded-lg font-medium"><Plus size={14} /> Add</button>}
        </div>
        {members.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No members yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Position</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Activity</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                {canEdit && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <Link href={`/dashboard/admin/workers/${m.id}`} className="hover:text-[#164FA3]">{m.name}</Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{m.position || "—"}</td>
                  <td className="px-4 py-3 text-gray-700 font-bold">{m.activity_score}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${m.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{m.status}</span>
                  </td>
                  {canEdit && <td className="px-4 py-3"><button onClick={() => removeMember(m.id)} className="text-gray-400 hover:text-red-500"><X size={16} /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && <AddMemberModal teamId={id} existing={members.map((m) => m.id)} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1"><Icon size={13} /> {label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}

function AddMemberModal({ teamId, existing, onClose, onSaved }) {
  const [search, setSearch] = useState("");
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      const p = new URLSearchParams({ limit: "20" });
      if (search) p.set("search", search);
      const r = await fetch(`/api/workers?${p}`);
      if (r.ok) setWorkers((await r.json()).workers || []);
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  async function add(workerId) {
    await fetch(`/api/teams/${teamId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ worker_id: workerId }) });
    onSaved();
  }
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Add Member</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search workers…" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
        <div className="max-h-80 overflow-auto divide-y divide-gray-100">
          {loading ? <div className="py-6 text-center text-gray-400"><Loader2 className="inline animate-spin" /></div> :
            workers.map((w) => {
              const already = existing.includes(w.id);
              return (
                <div key={w.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="font-medium text-gray-900 text-sm">{w.name}</div>
                    <div className="text-xs text-gray-500">{w.position || "—"} · {w.district_name || "—"}</div>
                  </div>
                  <button disabled={already} onClick={() => add(w.id)} className={`text-xs px-3 py-1 rounded-lg font-semibold ${already ? "bg-gray-100 text-gray-400" : "bg-[#164FA3] text-white hover:bg-blue-800"}`}>
                    {already ? "Added" : "Add"}
                  </button>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
