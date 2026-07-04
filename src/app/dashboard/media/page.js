"use client";

import { useEffect, useState, useRef } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { canAccessMedia } from "@/lib/permissions";
import {
  Newspaper, Tv, Mic, UserCheck, BarChart3, Upload, Plus, Loader2, X,
  Calendar, FileText, MessageCircle, CheckCircle2, TrendingUp, Eye, Pencil,
} from "lucide-react";

export default function Page() {
  return <SupervisorGuard allow={canAccessMedia}><Body /></SupervisorGuard>;
}

const TABS = [
  { k: "newspapers", l: "Newspapers", icon: Newspaper },
  { k: "channels", l: "News Channels", icon: Tv },
  { k: "conferences", l: "Press Conferences", icon: Mic },
  { k: "spokespersons", l: "Spokespersons", icon: UserCheck },
  { k: "analytics", l: "Analytics", icon: BarChart3 },
];

function Body() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("newspapers");

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const r = await fetch("/api/media");
    if (r.ok) setData(await r.json());
    setLoading(false);
  }

  if (loading || !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Media Center</h1>
        <p className="text-gray-500 mt-2 font-medium">Newspaper coverage, debates, press conferences and spokespersons in one place.</p>
      </div>

      <div className="flex gap-2 flex-wrap border-b border-gray-200">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.k} onClick={() => setTab(t.k)} className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${tab === t.k ? "border-[#164FA3] text-[#164FA3]" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
              <Icon size={16} /> {t.l}
            </button>
          );
        })}
      </div>

      {tab === "newspapers" && <NewspapersTab data={data} onChange={load} />}
      {tab === "channels" && <ChannelsTab data={data} onChange={load} />}
      {tab === "conferences" && <ConferencesTab data={data} onChange={load} />}
      {tab === "spokespersons" && <SpokespersonsTab data={data} onChange={load} />}
      {tab === "analytics" && <AnalyticsTab data={data} />}
    </div>
  );
}

// ============================================================ NEWSPAPERS
function NewspapersTab({ data, onChange }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {data.newspapers.map((np) => (
          <div key={np.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <Newspaper className="text-[#164FA3] mb-2" size={20} />
            <div className="font-bold text-gray-900 text-sm">{np.name}</div>
            <div className="text-xs text-gray-500 mt-1">{np.circulation || "—"}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-900">Press Notes & Coverage Archive</h3>
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3 py-1.5 rounded-lg text-sm font-semibold">
          <Plus size={14} /> Upload
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {data.recentNotes.length === 0 ? (
          <div className="p-8 text-gray-400 text-sm text-center">No press notes yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">Date</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Title</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Newspaper</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Type</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Sentiment</th>
                <th className="px-4 py-3 font-semibold text-gray-600">File</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.recentNotes.map((n) => (
                <tr key={n.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{n.coverage_date?.slice(0, 10) || "—"}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{n.title}</td>
                  <td className="px-4 py-3 text-gray-600">{n.newspaper_name || "—"}</td>
                  <td className="px-4 py-3"><span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{n.kind.replace("_", " ")}</span></td>
                  <td className="px-4 py-3"><SentimentBadge s={n.sentiment} /></td>
                  <td className="px-4 py-3">
                    {n.file_url ? <a href={n.file_url} target="_blank" rel="noreferrer" className="text-[#164FA3] hover:underline text-xs flex items-center gap-1"><FileText size={13} /> Open</a> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setEditing(n)} title="Edit" className="p-1.5 text-gray-400 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg"><Pencil size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && <PressNoteModal newspapers={data.newspapers} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); onChange(); }} />}
      {editing && <PressNoteModal editing={editing} newspapers={data.newspapers} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); }} />}
    </div>
  );
}

function SentimentBadge({ s }) {
  if (!s) return <span className="text-gray-300 text-xs">—</span>;
  const map = { positive: "bg-emerald-100 text-emerald-700", neutral: "bg-gray-100 text-gray-600", negative: "bg-red-100 text-red-700" };
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${map[s]}`}>{s}</span>;
}

// ============================================================ CHANNELS
function ChannelsTab({ data, onChange }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const TONE = { supportive: "bg-emerald-100 text-emerald-700", neutral: "bg-gray-100 text-gray-600", opposing: "bg-red-100 text-red-700", unknown: "bg-amber-100 text-amber-700" };
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {data.channels.map((c) => (
          <div key={c.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <Tv className="text-[#164FA3] mb-2" size={20} />
            <div className="font-bold text-gray-900 text-sm">{c.name}</div>
            <span className={`mt-2 inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${TONE[c.tone]}`}>{c.tone}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-900">Today's & Upcoming Debates</h3>
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3 py-1.5 rounded-lg text-sm font-semibold">
          <Plus size={14} /> Schedule Debate
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {data.upcomingDebates.length === 0 ? (
          <div className="p-8 text-gray-400 text-sm text-center">No debates scheduled.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">When</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Channel</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Topic</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Assigned</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Brief</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.upcomingDebates.map((d) => (
                <tr key={d.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {d.debate_date?.slice(0, 10)}{d.debate_time ? ` @ ${d.debate_time.slice(0, 5)}` : ""}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{d.channel_name || "—"}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{d.topic}</td>
                  <td className="px-4 py-3 text-gray-600">{d.assignee_count} spokesperson{d.assignee_count === 1 ? "" : "s"}</td>
                  <td className="px-4 py-3"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${d.status === "aired" ? "bg-blue-100 text-blue-700" : d.status === "live" ? "bg-red-100 text-red-700" : d.status === "cancelled" ? "bg-gray-100 text-gray-400" : "bg-amber-100 text-amber-700"}`}>{d.status}</span></td>
                  <td className="px-4 py-3">
                    {d.brief_pdf_url ? <a href={d.brief_pdf_url} target="_blank" rel="noreferrer" className="text-[#164FA3] hover:underline text-xs flex items-center gap-1"><FileText size={13} /> PDF</a> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setEditing(d)} title="Edit debate" className="p-1.5 text-gray-400 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg"><Pencil size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && <DebateModal channels={data.channels} spokespersons={data.spokespersons} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); onChange(); }} />}
      {editing && <DebateModal editing={editing} channels={data.channels} spokespersons={data.spokespersons} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); }} />}
    </div>
  );
}

// ============================================================ CONFERENCES
function ConferencesTab({ data, onChange }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [inviting, setInviting] = useState(null);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-900">Press Conference Calendar</h3>
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3 py-1.5 rounded-lg text-sm font-semibold">
          <Plus size={14} /> Schedule
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.conferences.length === 0 ? (
          <div className="col-span-full bg-white rounded-2xl p-8 text-center text-gray-400 text-sm border border-gray-100">No press conferences.</div>
        ) : data.conferences.map((c) => (
          <div key={c.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">{new Date(c.conference_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", weekday: "short" })}</div>
                <h4 className="font-bold text-gray-900 mt-1">{c.title}</h4>
                {c.venue && <div className="text-xs text-gray-500 mt-1">{c.venue}</div>}
              </div>
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${c.status === "completed" ? "bg-emerald-100 text-emerald-700" : c.status === "cancelled" ? "bg-gray-100 text-gray-400" : "bg-amber-100 text-amber-700"}`}>{c.status}</span>
            </div>
            <div className="flex items-center justify-between mt-4 text-xs">
              <span className="text-gray-500"><strong className="text-gray-900">{c.invited}</strong> invited · <strong className="text-emerald-700">{c.attended}</strong> attended</span>
              <div className="flex gap-2 items-center">
                <button onClick={() => setEditing(c)} title="Edit conference" className="p-1 text-gray-400 hover:text-[#164FA3]"><Pencil size={13} /></button>
                <button onClick={() => setInviting(c)} className="text-[#164FA3] font-semibold hover:underline">Manage invites →</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showAdd && <ConferenceModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); onChange(); }} />}
      {editing && <ConferenceModal editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); }} />}
      {inviting && <InviteModal conference={inviting} journalists={data.journalists} onClose={() => setInviting(null)} onChange={onChange} />}
    </div>
  );
}

// ============================================================ SPOKESPERSONS
function SpokespersonsTab({ data, onChange }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-900">Spokesperson Panel ({data.spokespersons.length})</h3>
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3 py-1.5 rounded-lg text-sm font-semibold">
          <Plus size={14} /> Add Spokesperson
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.spokespersons.map((s) => (
          <div key={s.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 relative group">
            <button onClick={() => setEditing(s)} title="Edit" className="absolute top-3 right-3 p-1.5 text-gray-300 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg opacity-0 group-hover:opacity-100"><Pencil size={13} /></button>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-[#164FA3] text-white flex items-center justify-center font-bold text-lg shrink-0">
                {s.name[0]?.toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="font-bold text-gray-900">{s.name}</div>
                {s.expertise && <div className="text-xs text-gray-500">{s.expertise}</div>}
                {s.languages && <div className="text-xs text-gray-400 mt-0.5">{s.languages}</div>}
                {s.mobile && <div className="text-xs text-gray-400 mt-0.5 font-mono">{s.mobile}</div>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {showAdd && <SpokespersonModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); onChange(); }} />}
      {editing && <SpokespersonModal editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); }} />}
    </div>
  );
}

function SpokespersonModal({ editing, onClose, onSaved }) {
  const [form, setForm] = useState(editing ? {
    name: editing.name || "", mobile: editing.mobile || "",
    expertise: editing.expertise || "", languages: editing.languages || "",
  } : { name: "", mobile: "", expertise: "", languages: "" });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const url = editing ? `/api/media/spokespersons/${editing.id}` : "/api/media/spokespersons";
    const method = editing ? "PUT" : "POST";
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) onSaved(); else setSaving(false);
  }
  return (
    <Modal title={editing ? "Edit Spokesperson" : "Add Spokesperson"} onClose={onClose}>
      <input className={inp} placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input className={inp} placeholder="Mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
      <input className={inp} placeholder="Expertise (e.g. Education, Health)" value={form.expertise} onChange={(e) => setForm({ ...form, expertise: e.target.value })} />
      <input className={inp} placeholder="Languages (e.g. Hindi, English)" value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} />
      <ModalActions onClose={onClose} onSave={save} saving={saving} disabled={!form.name} />
    </Modal>
  );
}

// ============================================================ ANALYTICS
function AnalyticsTab({ data }) {
  const a = data.analytics;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SumCard label="Coverage (30d)" value={a.counts?.coverage_total || 0} accent />
        <SumCard label="Positive" value={a.counts?.positive || 0} />
        <SumCard label="Neutral" value={a.counts?.neutral || 0} />
        <SumCard label="Negative" value={a.counts?.negative || 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><Tv size={16} className="text-[#164FA3]" /> Channel Tone</h3>
          <div className="space-y-2">
            {a.channelTone.map((c) => (
              <div key={c.tone} className="flex items-center justify-between text-sm">
                <span className="capitalize text-gray-700">{c.tone}</span>
                <span className="font-bold text-gray-900">{c.n}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-[#FCB712]" /> Top Spokespersons</h3>
          <ul className="space-y-2">
            {a.topSpokespersons.length === 0 ? <li className="text-gray-400 text-sm">No debate data yet.</li> :
              a.topSpokespersons.map((s, i) => (
                <li key={s.id} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2 last:border-0">
                  <span className="flex items-center gap-2"><span className="font-bold text-gray-400 w-5">{i + 1}</span>{s.name}</span>
                  <span className="text-xs text-gray-500"><strong className="text-gray-900">{s.debates}</strong> debates · viral <strong className="text-[#FCB712]">{s.total_viral}</strong></span>
                </li>
              ))}
          </ul>
        </div>
      </div>
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

// ============================================================ MODALS

function FileUpload({ value, onChange, accept = ".pdf,image/*" }) {
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  async function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    const fd = new FormData(); fd.append("file", f);
    const r = await fetch("/api/uploads", { method: "POST", body: fd });
    setBusy(false);
    if (r.ok) onChange((await r.json()).url);
  }
  return (
    <div className="flex items-center gap-2">
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={pick} />
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 text-xs border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {value ? "Replace" : "Upload"}
      </button>
      {value && <a href={value} target="_blank" rel="noreferrer" className="text-xs text-[#164FA3] hover:underline">View file</a>}
    </div>
  );
}

const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";

function PressNoteModal({ newspapers, onClose, onSaved, editing }) {
  const [form, setForm] = useState(editing ? {
    title: editing.title || "", summary: editing.summary || "", kind: editing.kind || "press_note",
    newspaper_id: editing.newspaper_id || "",
    coverage_date: editing.coverage_date ? editing.coverage_date.slice(0, 10) : "",
    sentiment: editing.sentiment || "", file_url: editing.file_url || "",
  } : { title: "", summary: "", kind: "press_note", newspaper_id: "", coverage_date: new Date().toISOString().slice(0, 10), sentiment: "", file_url: "" });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const url = editing ? `/api/media/press-notes/${editing.id}` : "/api/media/press-notes";
    const method = editing ? "PUT" : "POST";
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) onSaved(); else setSaving(false);
  }
  return (
    <Modal title={editing ? "Edit Press Note / Coverage" : "Upload Press Note / Coverage"} onClose={onClose}>
      <input className={inp} placeholder="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <textarea className={inp} rows={2} placeholder="Summary" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <select className={inp} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          <option value="press_note">Press Note</option>
          <option value="newspaper_scan">Newspaper Scan</option>
          <option value="article_pdf">Article PDF</option>
        </select>
        <select className={inp} value={form.newspaper_id} onChange={(e) => setForm({ ...form, newspaper_id: e.target.value })}>
          <option value="">Newspaper</option>
          {newspapers.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <input type="date" className={inp} value={form.coverage_date} onChange={(e) => setForm({ ...form, coverage_date: e.target.value })} />
        <select className={inp} value={form.sentiment} onChange={(e) => setForm({ ...form, sentiment: e.target.value })}>
          <option value="">Sentiment</option>
          <option value="positive">Positive</option>
          <option value="neutral">Neutral</option>
          <option value="negative">Negative</option>
        </select>
      </div>
      <div><label className="text-xs text-gray-500 mb-1 block">File</label><FileUpload value={form.file_url} onChange={(url) => setForm({ ...form, file_url: url })} /></div>
      <ModalActions onClose={onClose} onSave={save} saving={saving} disabled={!form.title} />
    </Modal>
  );
}

function DebateModal({ channels, spokespersons, onClose, onSaved, editing }) {
  const [form, setForm] = useState(editing ? {
    channel_id: editing.channel_id || "", topic: editing.topic || "",
    debate_date: editing.debate_date ? editing.debate_date.slice(0, 10) : "",
    debate_time: editing.debate_time ? editing.debate_time.slice(0, 5) : "20:00",
    brief_pdf_url: editing.brief_pdf_url || "",
    talking_points: editing.talking_points || "",
    opposition_counter: editing.opposition_counter || "",
    status: editing.status || "scheduled",
    viral_score: editing.viral_score || 0,
    spokesperson_ids: [],
  } : { channel_id: "", topic: "", debate_date: "", debate_time: "20:00", brief_pdf_url: "", talking_points: "", opposition_counter: "", spokesperson_ids: [] });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const url = editing ? `/api/media/debates/${editing.id}` : "/api/media/debates";
    const method = editing ? "PUT" : "POST";
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) onSaved(); else setSaving(false);
  }
  function toggleSp(id) {
    const next = form.spokesperson_ids.includes(id) ? form.spokesperson_ids.filter((x) => x !== id) : [...form.spokesperson_ids, id];
    setForm({ ...form, spokesperson_ids: next });
  }
  return (
    <Modal title={editing ? "Edit Debate" : "Schedule Debate"} onClose={onClose}>
      <input className={inp} placeholder="Topic *" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <select className={inp} value={form.channel_id} onChange={(e) => setForm({ ...form, channel_id: e.target.value })}>
          <option value="">Channel</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" className={inp} value={form.debate_date} onChange={(e) => setForm({ ...form, debate_date: e.target.value })} />
        <input type="time" className={inp} value={form.debate_time} onChange={(e) => setForm({ ...form, debate_time: e.target.value })} />
        <div><label className="text-xs text-gray-500 mb-1 block">Brief PDF</label><FileUpload value={form.brief_pdf_url} onChange={(url) => setForm({ ...form, brief_pdf_url: url })} /></div>
      </div>
      <textarea className={inp} rows={2} placeholder="Talking points" value={form.talking_points} onChange={(e) => setForm({ ...form, talking_points: e.target.value })} />
      <textarea className={inp} rows={2} placeholder="Opposition counter points" value={form.opposition_counter} onChange={(e) => setForm({ ...form, opposition_counter: e.target.value })} />
      {editing && (
        <div className="grid grid-cols-2 gap-3">
          <select className={inp} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="scheduled">Scheduled</option>
            <option value="live">Live</option>
            <option value="aired">Aired</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input type="number" min="0" max="100" placeholder="Viral score 0-100" className={inp} value={form.viral_score} onChange={(e) => setForm({ ...form, viral_score: e.target.value })} />
        </div>
      )}
      {!editing && (
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Assign spokespersons</label>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
            {spokespersons.map((s) => {
              const on = form.spokesperson_ids.includes(s.id);
              return <button key={s.id} type="button" onClick={() => toggleSp(s.id)} className={`text-xs px-2.5 py-1 rounded-full border ${on ? "bg-[#164FA3] text-white border-[#164FA3]" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>{s.name}</button>;
            })}
          </div>
        </div>
      )}
      <ModalActions onClose={onClose} onSave={save} saving={saving} disabled={!form.topic || !form.debate_date} />
    </Modal>
  );
}

function ConferenceModal({ onClose, onSaved, editing }) {
  const [form, setForm] = useState(editing ? {
    title: editing.title || "",
    conference_date: editing.conference_date ? new Date(editing.conference_date).toISOString().slice(0, 16) : "",
    venue: editing.venue || "",
    agenda: editing.agenda || "",
    status: editing.status || "scheduled",
  } : { title: "", conference_date: "", venue: "AAP State Office, Raipur", agenda: "" });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const url = editing ? `/api/media/conferences/${editing.id}` : "/api/media/conferences";
    const method = editing ? "PUT" : "POST";
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) onSaved(); else setSaving(false);
  }
  return (
    <Modal title={editing ? "Edit Press Conference" : "Schedule Press Conference"} onClose={onClose}>
      <input className={inp} placeholder="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <input type="datetime-local" className={inp} value={form.conference_date} onChange={(e) => setForm({ ...form, conference_date: e.target.value })} />
      <input className={inp} placeholder="Venue" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
      <textarea className={inp} rows={3} placeholder="Agenda" value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} />
      {editing && (
        <select className={inp} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      )}
      <ModalActions onClose={onClose} onSave={save} saving={saving} disabled={!form.title || !form.conference_date} />
    </Modal>
  );
}

function InviteModal({ conference, journalists, onClose, onChange }) {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const r = await fetch(`/api/media/conferences/${conference.id}/invites`);
    if (r.ok) setInvites((await r.json()).invites);
    setLoading(false);
  }
  async function patch(journalist_id, patchFields) {
    const existing = invites.find((i) => i.journalist_id === journalist_id);
    const payload = {
      journalist_id,
      whatsapp_sent: existing?.whatsapp_sent || 0,
      call_reminder_sent: existing?.call_reminder_sent || 0,
      attended: existing?.attended || 0,
      ...patchFields,
    };
    await fetch(`/api/media/conferences/${conference.id}/invites`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    load();
    onChange();
  }

  return (
    <Modal title={`Invites — ${conference.title}`} onClose={onClose} wide>
      {loading ? <Loader2 className="animate-spin" /> : (
        <div className="space-y-2 max-h-[60vh] overflow-auto">
          {journalists.map((j) => {
            const inv = invites.find((i) => i.journalist_id === j.id);
            const invited = !!inv;
            return (
              <div key={j.id} className="flex items-center justify-between gap-2 border border-gray-100 rounded-lg px-3 py-2">
                <div>
                  <div className="font-medium text-gray-900 text-sm">{j.name}</div>
                  <div className="text-xs text-gray-500">{j.outlet || "—"}{j.mobile ? ` · ${j.mobile}` : ""}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Toggle label="WA" active={!!inv?.whatsapp_sent} onClick={() => patch(j.id, { whatsapp_sent: inv?.whatsapp_sent ? 0 : 1 })} icon={MessageCircle} />
                  <Toggle label="Call" active={!!inv?.call_reminder_sent} onClick={() => patch(j.id, { call_reminder_sent: inv?.call_reminder_sent ? 0 : 1 })} icon={CheckCircle2} />
                  <Toggle label="Attended" active={!!inv?.attended} onClick={() => patch(j.id, { attended: inv?.attended ? 0 : 1 })} icon={UserCheck} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="text-xs text-gray-400 mt-3">Toggles mark invite/reminder/attendance status. WhatsApp send is logged; actual delivery requires WhatsApp Business API configuration.</div>
    </Modal>
  );
}

function Toggle({ label, active, onClick, icon: Icon }) {
  return (
    <button type="button" onClick={onClick} className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1 border ${active ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
      <Icon size={12} /> {label}
    </button>
  );
}

function Modal({ title, children, onClose, wide }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? "max-w-2xl" : "max-w-lg"} p-6 space-y-3 max-h-[90vh] overflow-auto`}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ onClose, onSave, saving, disabled }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
      <button onClick={onSave} disabled={saving || disabled} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : "Save"}</button>
    </div>
  );
}
