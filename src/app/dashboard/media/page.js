"use client";

import { useEffect, useState, useRef } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { canAccessMedia } from "@/lib/permissions";
import {
  LayoutDashboard, Newspaper, Tv, Mic, UserCheck, BarChart3, Upload, Plus, Loader2, X,
  Calendar, FileText, MessageCircle, CheckCircle2, TrendingUp, Eye, Pencil, ChevronDown, Check,
} from "lucide-react";
import MediaDashboardTab from "@/components/media/MediaDashboardTab";

export default function Page() {
  return <SupervisorGuard allow={canAccessMedia}><Body /></SupervisorGuard>;
}

const TABS = [
  { k: "dashboard", l: "Dashboard", icon: LayoutDashboard },
  { k: "newspapers", l: "Newspapers", icon: Newspaper },
  { k: "channels", l: "News Channels", icon: Tv },
  { k: "conferences", l: "Press Conferences", icon: Mic },
  { k: "spokespersons", l: "Spokespersons", icon: UserCheck },
  { k: "analytics", l: "Analytics", icon: BarChart3 },
];

function Body() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState("");

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3500); return () => clearTimeout(t); }, [toast]);
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
      {toast && <div className="fixed top-4 right-4 z-[80] flex items-center gap-2 bg-emerald-600 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg"><CheckCircle2 size={16} /> {toast}</div>}
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

      {tab === "dashboard" && <MediaDashboardTab />}
      {tab === "newspapers" && <NewspapersTab data={data} onChange={load} flash={setToast} />}
      {tab === "channels" && <ChannelsTab data={data} onChange={load} flash={setToast} />}
      {tab === "conferences" && <ConferencesTab data={data} onChange={load} />}
      {tab === "spokespersons" && <SpokespersonsTab data={data} onChange={load} />}
      {tab === "analytics" && <AnalyticsTab data={data} />}
    </div>
  );
}

// ============================================================ NEWSPAPERS
// Content-Type options (value stored in press_notes.kind, label shown in UI).
const CONTENT_TYPES = [
  { v: "press_note", l: "Press Note" },
  { v: "news_article", l: "News Article" },
  { v: "newspaper_coverage", l: "Newspaper Coverage" },
  { v: "tv_news_channel", l: "TV / News Channel" },
  { v: "online_news", l: "Online News" },
  { v: "interview", l: "Interview" },
  { v: "press_conference", l: "Press Conference" },
  { v: "other", l: "Other" },
];
// Human label for a stored kind — falls back to a de-slugged title for any
// legacy value (e.g. the old "newspaper_scan").
function contentLabel(kind) {
  if (!kind) return "—";
  const hit = CONTENT_TYPES.find((c) => c.v === kind);
  if (hit) return hit.l;
  return String(kind).replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
const NEWSPAPER_OTHER = "__other__";

function NewspapersTab({ data, onChange, flash }) {
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
          <div className="overflow-x-auto">
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
                  <td className="px-4 py-3"><span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{contentLabel(n.kind)}</span></td>
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
          </div>
        )}
      </div>

      {showAdd && <PressNoteModal newspapers={data.newspapers} onClose={() => setShowAdd(false)} onSaved={(msg) => { setShowAdd(false); onChange(); flash?.(msg); }} />}
      {editing && <PressNoteModal editing={editing} newspapers={data.newspapers} onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); onChange(); flash?.(msg); }} />}
    </div>
  );
}

function SentimentBadge({ s }) {
  if (!s) return <span className="text-gray-300 text-xs">—</span>;
  const map = { positive: "bg-emerald-100 text-emerald-700", neutral: "bg-gray-100 text-gray-600", negative: "bg-red-100 text-red-700" };
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${map[s]}`}>{s}</span>;
}

// ============================================================ CHANNELS
function ChannelsTab({ data, onChange, flash }) {
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
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">When</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Channel</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Topic</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Spokespersons</th>
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
                  <td className="px-4 py-3 text-gray-600">{(d.spokespersons && d.spokespersons.length) ? d.spokespersons.map((s) => s.name).join(", ") : <span className="text-gray-300">—</span>}</td>
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
          </div>
        )}
      </div>

      {showAdd && <DebateModal channels={data.channels} spokespersons={data.spokespersons} onClose={() => setShowAdd(false)} onSaved={(msg) => { setShowAdd(false); onChange(); flash?.(msg); }} />}
      {editing && <DebateModal editing={editing} channels={data.channels} spokespersons={data.spokespersons} onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); onChange(); flash?.(msg); }} />}
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

// Extensions the upload accepts, kept in sync with the backend sniffer
// (mediaFileSniff). Used for the friendly "supported formats" hint, the
// image-vs-document preview, and a lenient frontend pre-check.
const UPLOAD_EXT_RE = /\.(jpe?g|png|webp|pdf|docx?)$/i;
const IMG_EXT_RE = /\.(jpe?g|png|webp)$/i;
function extFromUrl(u = "") { return (String(u).split(".").pop() || "").toLowerCase(); }

function FileUpload({ value, onChange, accept = ".pdf,image/*", endpoint = "/api/uploads", maxMB = 25 }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const ref = useRef(null);
  async function pick(e) {
    const f = e.target.files?.[0];
    if (e.target) e.target.value = ""; // allow re-selecting the same file
    if (!f) return;
    setErr("");
    // Frontend validation (backend re-validates by magic bytes). Reject clearly
    // BEFORE uploading so a genuinely unsupported file gives an instant, precise
    // message — and a valid one never trips a false "upload failed".
    if (!UPLOAD_EXT_RE.test(f.name || "")) {
      setErr("Unsupported format. Use JPG, JPEG, PNG, WEBP or PDF.");
      return;
    }
    if (f.size > maxMB * 1024 * 1024) { setErr(`File too large (max ${maxMB} MB).`); return; }
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      const r = await fetch(endpoint, { method: "POST", body: fd });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || "File upload failed. Please check the file and try again.");
      setName(f.name);
      onChange(body.url);
    } catch (e2) {
      setErr(e2.message || "File upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const isImg = value && IMG_EXT_RE.test(value);
  const ext = value ? extFromUrl(value) : "";
  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <input ref={ref} type="file" accept={accept} className="hidden" onChange={pick} />
        <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 text-xs border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50">
          {busy ? <><Loader2 size={13} className="animate-spin" /> Uploading…</> : <><Upload size={13} /> {value ? "Replace file" : "Upload file"}</>}
        </button>
        {value && !busy && (
          <span className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 pl-1.5 pr-2 py-1">
            {isImg
              ? <img src={value} alt="" className="w-9 h-9 rounded object-cover border border-gray-200" />
              : <span className="w-9 h-9 rounded bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center"><FileText size={16} /></span>}
            <span className="flex flex-col leading-tight">
              <a href={value} target="_blank" rel="noreferrer" className="text-xs text-[#164FA3] hover:underline max-w-[10rem] truncate" title={name || value}>{name || `Uploaded ${ext.toUpperCase()}`}</a>
              <span className="text-[10px] text-gray-400 uppercase">{ext} · uploaded</span>
            </span>
            <button type="button" onClick={() => { setName(""); setErr(""); onChange(""); }} title="Remove file" className="text-gray-400 hover:text-red-500 ml-0.5"><X size={13} /></button>
          </span>
        )}
      </div>
      {err && <div className="text-xs text-red-600 mt-1">{err}</div>}
    </div>
  );
}

const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";

function PressNoteModal({ newspapers, onClose, onSaved, editing }) {
  const [form, setForm] = useState(editing ? {
    title: editing.title || "", summary: editing.summary || "", kind: editing.kind || "press_note",
    newspaper_id: editing.newspaper_id ? String(editing.newspaper_id) : "",
    newspaper_name: "",
    coverage_date: editing.coverage_date ? String(editing.coverage_date).slice(0, 10) : "",
    sentiment: editing.sentiment || "", file_url: editing.file_url || "",
  } : { title: "", summary: "", kind: "press_note", newspaper_id: "", newspaper_name: "", coverage_date: new Date().toISOString().slice(0, 10), sentiment: "", file_url: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isOther = form.newspaper_id === NEWSPAPER_OTHER;

  async function save() {
    setError("");
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (isOther && !form.newspaper_name.trim()) { setError("Enter the newspaper name for “Other”."); return; }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        summary: form.summary,
        kind: form.kind,
        coverage_date: form.coverage_date || "",
        sentiment: form.sentiment || "",
        file_url: form.file_url || "",
      };
      if (isOther) { payload.newspaper_name = form.newspaper_name.trim(); payload.newspaper_id = ""; }
      else { payload.newspaper_id = form.newspaper_id || ""; }
      const url = editing ? `/api/media/press-notes/${editing.id}` : "/api/media/press-notes";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || "Unable to save changes. Please try again.");
      onSaved(editing ? "Press coverage updated successfully." : "Press coverage added successfully.");
    } catch (e) {
      setError(e.message || "Unable to save changes. Please try again.");
      setSaving(false); // keep the modal open, preserve entered data
    }
  }
  return (
    <Modal title={editing ? "Edit Press Note / Coverage" : "Upload Press Note / Coverage"} onClose={onClose}>
      <input className={inp} placeholder="Title *" value={form.title} onChange={(e) => set("title", e.target.value)} />
      <textarea className={inp} rows={2} placeholder="Description / Content" value={form.summary} onChange={(e) => set("summary", e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Content Type</label>
          <select className={inp} value={form.kind} onChange={(e) => set("kind", e.target.value)}>
            {CONTENT_TYPES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Newspaper</label>
          <select className={inp} value={form.newspaper_id} onChange={(e) => set("newspaper_id", e.target.value)}>
            <option value="">— Select newspaper —</option>
            {newspapers.map((n) => <option key={n.id} value={String(n.id)}>{n.name}</option>)}
            <option value={NEWSPAPER_OTHER}>Other…</option>
          </select>
        </div>
        {isOther && (
          <div className="col-span-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Other Newspaper Name *</label>
            <input className={inp} placeholder="Type the newspaper name" value={form.newspaper_name} onChange={(e) => set("newspaper_name", e.target.value)} />
          </div>
        )}
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Date</label>
          <input type="date" className={inp} value={form.coverage_date} onChange={(e) => set("coverage_date", e.target.value)} />
        </div>
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Sentiment</label>
          <select className={inp} value={form.sentiment} onChange={(e) => set("sentiment", e.target.value)}>
            <option value="">— Select —</option>
            <option value="positive">Positive</option>
            <option value="neutral">Neutral</option>
            <option value="negative">Negative</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">File (PDF, JPG, PNG, WEBP, DOC, DOCX)</label>
        <FileUpload value={form.file_url} onChange={(url) => set("file_url", url)} endpoint="/api/media/uploads" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" />
      </div>
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <ModalActions onClose={onClose} onSave={save} saving={saving} disabled={!form.title.trim()} />
    </Modal>
  );
}

// Searchable multi-select for spokespersons. Options come from the live
// Spokespersons module (data.spokespersons); nothing is hardcoded. Value is an
// array of spokesperson IDs. Selected people show as removable chips.
function SpokespersonMultiSelect({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const selected = options.filter((o) => value.includes(o.id));
  const filtered = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between hover:bg-gray-50">
        <span className={selected.length ? "text-gray-800" : "text-gray-400"}>{selected.length ? `${selected.length} spokesperson${selected.length === 1 ? "" : "s"} selected` : "Select spokesperson(s)"}</span>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search spokesperson…" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
          </div>
          <div className="max-h-48 overflow-auto">
            {options.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">No spokespersons exist yet. Add them on the Spokespersons tab.</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">No match for “{q}”.</div>
            ) : filtered.map((o) => {
              const on = value.includes(o.id);
              return (
                <button key={o.id} type="button" onClick={() => toggle(o.id)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50">
                  <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? "bg-[#164FA3] border-[#164FA3]" : "border-gray-300"}`}>{on && <Check size={12} className="text-white" />}</span>
                  <span className="truncate">{o.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selected.map((o) => (
            <span key={o.id} className="inline-flex items-center gap-1 text-xs bg-[#164FA3]/10 text-[#164FA3] px-2 py-1 rounded-full">
              {o.name}
              <button type="button" onClick={() => toggle(o.id)} className="hover:text-red-600"><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
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
    spokesperson_ids: (editing.spokespersons || []).map((s) => s.id),
  } : { channel_id: "", topic: "", debate_date: "", debate_time: "20:00", brief_pdf_url: "", talking_points: "", opposition_counter: "", spokesperson_ids: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setError("");
    if (!form.topic.trim()) { setError("Topic is required."); return; }
    if (!form.debate_date) { setError("Debate date is required."); return; }
    setSaving(true);
    try {
      const url = editing ? `/api/media/debates/${editing.id}` : "/api/media/debates";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || "Unable to save the debate. Please try again.");
      onSaved(editing ? "Debate updated successfully." : "Debate scheduled successfully.");
    } catch (e) {
      setError(e.message || "Unable to save the debate. Please try again.");
      setSaving(false); // keep modal open, preserve entered data
    }
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
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Select Spokesperson</label>
        <SpokespersonMultiSelect options={spokespersons} value={form.spokesperson_ids} onChange={(ids) => setForm({ ...form, spokesperson_ids: ids })} />
      </div>
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
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <ModalActions onClose={onClose} onSave={save} saving={saving} disabled={!form.topic.trim() || !form.debate_date} />
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
