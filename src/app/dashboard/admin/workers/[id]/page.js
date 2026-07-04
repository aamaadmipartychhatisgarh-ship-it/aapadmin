"use client";

import { useEffect, useState, use } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isAdmin, isOversight } from "@/lib/permissions";
import { ArrowLeft, User, Phone, MapPin, Activity, Award, Users as UsersIcon, Loader2, Save, Trash2 } from "lucide-react";

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
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, [id]);
  async function load() {
    setLoading(true);
    const r = await fetch(`/api/workers/${id}`);
    if (r.ok) {
      const d = await r.json();
      setData(d);
      setForm({ name: d.worker.name, mobile: d.worker.mobile || "", position: d.worker.position || "",
        skills: d.worker.skills || "", status: d.worker.status, activity_score: d.worker.activity_score, address: d.worker.address || "" });
    }
    setLoading(false);
  }
  async function save() {
    setSaving(true);
    await fetch(`/api/workers/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setSaving(false); setEditing(false); load();
  }
  async function del() {
    if (!confirm("Delete this worker?")) return;
    await fetch(`/api/workers/${id}`, { method: "DELETE" });
    router.push("/dashboard/admin/workers");
  }

  if (loading || !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  const w = data.worker;
  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl">
      <Link href="/dashboard/admin/workers" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#164FA3]"><ArrowLeft size={16} /> Back to workers</Link>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            {w.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={w.photo_url} alt={w.name} className="w-16 h-16 rounded-full object-cover border-2 border-[#164FA3]" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-[#164FA3] text-white flex items-center justify-center text-2xl font-bold">
                {w.name[0]?.toUpperCase()}
              </div>
            )}
            <div>
              {!editing ? (
                <>
                  <h1 className="text-2xl font-bold text-gray-900">{w.name}</h1>
                  <p className="text-gray-500">{w.position || "—"}</p>
                </>
              ) : (
                <input className={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              )}
            </div>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              {!editing ? (
                <>
                  <button onClick={() => setEditing(true)} className="px-4 py-2 text-sm bg-[#164FA3] text-white rounded-lg font-medium">Edit</button>
                  <button onClick={del} className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"><Trash2 size={16} /></button>
                </>
              ) : (
                <>
                  <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-[#164FA3] text-white rounded-lg font-medium flex items-center gap-1"><Save size={14} /> {saving ? "Saving…" : "Save"}</button>
                  <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <Detail icon={Phone} label="Mobile">
            {editing ? <input className={inp} value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /> : (w.mobile || "—")}
          </Detail>
          <Detail icon={User} label="Designation">
            {editing ? <input className={inp} value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /> : (w.position || "—")}
          </Detail>
          <Detail icon={MapPin} label="Address">
            {editing ? <input className={inp} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /> : (w.address || "—")}
          </Detail>
          <Detail icon={MapPin} label="Location">
            {[w.zone_name, w.lok_sabha_name, w.district_name, w.assembly_name, w.ward_name, w.booth_name].filter(Boolean).join(" / ") || "—"}
          </Detail>
          <Detail icon={Activity} label="Status">
            {editing ? (
              <select className={inp} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option><option value="inactive">Inactive</option>
              </select>
            ) : (
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${w.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{w.status}</span>
            )}
          </Detail>
          <Detail icon={Activity} label="Activity Score">
            {editing ? (
              <input type="range" min="0" max="100" value={form.activity_score} onChange={(e) => setForm({ ...form, activity_score: Number(e.target.value) })} className="w-full" />
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-32 h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#164FA3]" style={{ width: `${w.activity_score}%` }} /></div>
                <span className="font-bold text-gray-700">{w.activity_score}</span>
              </div>
            )}
          </Detail>
          <Detail icon={User} label="Skills">
            {editing ? <input className={inp} value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} /> : (w.skills || "—")}
          </Detail>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><UsersIcon size={18} className="text-[#164FA3]" /> Teams</h2>
          {data.teams.length === 0 ? <p className="text-gray-400 text-sm">Not in any team.</p> : (
            <ul className="space-y-2">{data.teams.map((t) => (
              <li key={t.id} className="flex items-center justify-between border-b border-gray-100 pb-2 text-sm">
                <span className="font-medium text-gray-800">{t.name}</span>
                <span className="text-xs text-gray-400 uppercase">{t.level}</span>
              </li>
            ))}</ul>
          )}
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><Award size={18} className="text-[#FCB712]" /> Badges</h2>
          {data.badges.length === 0 ? <p className="text-gray-400 text-sm">No badges yet.</p> : (
            <div className="flex flex-wrap gap-2">{data.badges.map((b, i) => (
              <span key={i} className="px-3 py-1.5 rounded-full text-xs font-semibold text-white" style={{ background: b.color || "#164FA3" }}>{b.name}</span>
            ))}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ icon: Icon, label, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1"><Icon size={13} /> {label}</div>
      <div className="text-gray-800">{children}</div>
    </div>
  );
}
