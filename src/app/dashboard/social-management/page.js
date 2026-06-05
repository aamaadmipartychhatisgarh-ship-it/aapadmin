"use client";

import { useEffect, useState, useRef } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import {
  Share2, Loader2, Plus, X, Upload, CheckCircle2, XCircle, Eye, Heart, MessageCircle,
  TrendingUp, AlertCircle, Clock, ThumbsUp, Camera, PlayCircle, ChevronRight, FileText, Pencil,
} from "lucide-react";

const PLATFORM = {
  facebook:  { label: "Facebook",  icon: ThumbsUp,      color: "#1877F2" },
  instagram: { label: "Instagram", icon: Camera,        color: "#E4405F" },
  whatsapp:  { label: "WhatsApp",  icon: MessageCircle, color: "#25D366" },
  youtube:   { label: "YouTube",   icon: PlayCircle,    color: "#FF0000" },
};
const POST_TYPE = ["post", "reel", "story", "video", "poster"];
const APPROVAL = {
  draft:    "bg-gray-100 text-gray-500",
  pending:  "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

const TABS = [
  { k: "overview", l: "Overview" },
  { k: "pages", l: "Pages" },
  { k: "approvals", l: "Approvals" },
  { k: "log", l: "Post Log" },
  { k: "per_ls", l: "Per Lok Sabha" },
];

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

function fmt(n) {
  n = Number(n || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function Body() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const r = await fetch("/api/social-management");
    if (r.ok) setData(await r.json());
    setLoading(false);
  }
  async function setStatus(postId, status) {
    await fetch(`/api/social-management/posts/${postId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approval_status: status, posted_at: status === "approved" ? new Date().toISOString().slice(0, 19).replace("T", " ") : null }) });
    load();
  }

  if (loading || !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  const o = data.overview || {};

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Social Media Command Center</h1>
          <p className="text-gray-500 mt-2 font-medium">Manual logging only — team posts on each platform, then logs it here. <span className="text-amber-600">Platform API integration not enabled.</span></p>
        </div>
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-md">
          <Plus size={16} /> Log a Post
        </button>
      </div>

      {/* Main Dashboard strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total Followers" value={fmt(o.total_followers)} accent />
        <Kpi label="Total Views" value={fmt(o.total_views)} />
        <Kpi label="Active Pages" value={o.active_pages || 0} />
        <Kpi label="Viral Posts" value={o.viral_posts || 0} />
        <Kpi label="Pending Approval" value={o.pending_posts || 0} highlight={Number(o.pending_posts) > 0} />
        <Kpi label="Today Uploads" value={o.today_uploads || 0} />
      </div>

      <div className="flex gap-2 flex-wrap border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${tab === t.k ? "border-[#164FA3] text-[#164FA3]" : "border-transparent text-gray-500 hover:text-gray-700"}`}>{t.l}</button>
        ))}
      </div>

      {tab === "overview"  && <OverviewTab data={data} />}
      {tab === "pages"     && <PagesTab data={data} />}
      {tab === "approvals" && <ApprovalsTab data={data} setStatus={setStatus} onEdit={setEditing} />}
      {tab === "log"       && <LogTab data={data} onEdit={setEditing} />}
      {tab === "per_ls"    && <PerLsTab data={data} />}

      {showAdd && <PostModal pages={data.pages} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {editing && <PostModal editing={editing} pages={data.pages} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function Kpi({ label, value, accent, highlight }) {
  return (
    <div className={`${accent ? "bg-[#164FA3] text-white" : highlight ? "bg-amber-50 border border-amber-200" : "bg-white border border-gray-100"} rounded-xl p-4 shadow-sm`}>
      <div className={`text-2xl font-bold ${accent ? "" : highlight ? "text-amber-700" : "text-gray-900"}`}>{value}</div>
      <div className={`text-xs font-medium mt-1 ${accent ? "text-blue-200" : highlight ? "text-amber-600" : "text-gray-500"}`}>{label}</div>
    </div>
  );
}

// ============================================================ OVERVIEW
function OverviewTab({ data }) {
  // Per-platform rollup
  const byPlatform = {};
  data.pages.forEach((p) => {
    if (!byPlatform[p.platform]) byPlatform[p.platform] = { pages: 0, followers: 0, views: 0 };
    byPlatform[p.platform].pages++;
    byPlatform[p.platform].followers += Number(p.followers) || 0;
    byPlatform[p.platform].views += Number(p.total_views) || 0;
  });
  // Platform performance — pages that haven't posted in 14d
  const stale = data.pages.filter((p) => !p.last_posted_at || (Date.now() - new Date(p.last_posted_at).getTime()) > 14 * 86400000);
  const viralPosts = data.recentPosts.filter((p) => p.viral).slice(0, 5);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h3 className="font-bold text-gray-900 mb-4">Platform Performance</h3>
        <div className="space-y-3">
          {Object.entries(byPlatform).map(([k, v]) => {
            const meta = PLATFORM[k]; const Icon = meta.icon;
            return (
              <div key={k} className="flex items-center justify-between border-b border-gray-100 pb-3 last:border-0">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: meta.color }}><Icon size={15} /></div>
                  <span className="font-medium text-gray-800">{meta.label}</span>
                </div>
                <div className="text-right text-xs text-gray-500">
                  <div><strong className="text-gray-900">{v.pages}</strong> pages · <strong className="text-gray-900">{fmt(v.followers)}</strong> followers</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-[#FCB712]" /> Viral Posts</h3>
        {viralPosts.length === 0 ? <p className="text-gray-400 text-sm">No viral posts yet.</p> : (
          <ul className="space-y-2">
            {viralPosts.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2 last:border-0">
                <div>
                  <div className="font-medium text-gray-900">{p.title || "(untitled)"}</div>
                  <div className="text-xs text-gray-400">{PLATFORM[p.platform]?.label} · {p.lok_sabha_name || "—"}</div>
                </div>
                <span className="text-xs text-gray-500 flex items-center gap-1"><Eye size={12} /> {fmt(p.views)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 lg:col-span-2">
        <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><AlertCircle size={16} className="text-amber-600" /> Pages that haven't posted in 14+ days ({stale.length})</h3>
        {stale.length === 0 ? <p className="text-gray-400 text-sm">All pages are active.</p> : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-72 overflow-auto">
            {stale.slice(0, 30).map((p) => {
              const meta = PLATFORM[p.platform]; const Icon = meta.icon;
              return (
                <div key={p.id} className="flex items-center gap-2 text-sm border border-gray-100 rounded-lg px-2.5 py-2">
                  <Icon size={14} style={{ color: meta.color }} />
                  <span className="flex-1 truncate"><strong className="text-gray-900">{p.lok_sabha_name}</strong> <span className="text-gray-400">{p.handle}</span></span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================ PAGES
function PagesTab({ data }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {data.pages.map((p) => {
        const meta = PLATFORM[p.platform]; const Icon = meta.icon;
        return (
          <div key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: meta.color }}><Icon size={16} /></div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-gray-900 text-sm truncate">{p.lok_sabha_name || "—"}</div>
                <div className="text-xs text-gray-500 truncate">{p.handle}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div><div className="text-gray-400">Followers</div><div className="font-bold text-gray-900">{fmt(p.followers)}</div></div>
              <div><div className="text-gray-400">Posts</div><div className="font-bold text-gray-900">{p.post_count}</div></div>
              <div><div className="text-gray-400">Views</div><div className="font-bold text-gray-900">{fmt(p.total_views)}</div></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================ APPROVALS
function ApprovalsTab({ data, setStatus, onEdit }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {data.pending.length === 0 ? (
        <div className="p-12 text-center text-gray-400"><CheckCircle2 size={36} className="mx-auto text-emerald-300 mb-3" />No posts awaiting approval.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-4 py-3 font-semibold text-gray-600">Title</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Type</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Page</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Submitted</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.pending.map((p) => {
              const meta = PLATFORM[p.platform] || {};
              const Icon = meta.icon || Share2;
              return (
                <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{p.title || <em className="text-gray-400">(untitled)</em>}</td>
                  <td className="px-4 py-3"><span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{p.post_type}</span></td>
                  <td className="px-4 py-3 text-gray-600 text-xs"><Icon size={12} style={{ color: meta.color }} className="inline mr-1" />{p.lok_sabha_name} · {p.handle}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(p.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      <button onClick={() => setStatus(p.id, "approved")} className="text-xs px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center gap-1"><CheckCircle2 size={12} /> Approve</button>
                      <button onClick={() => setStatus(p.id, "rejected")} className="text-xs px-2.5 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 font-semibold inline-flex items-center gap-1"><XCircle size={12} /> Reject</button>
                      <button onClick={() => onEdit(p)} title="Edit" className="p-1.5 text-gray-400 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg"><Pencil size={13} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ============================================================ LOG
function LogTab({ data, onEdit }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left">
          <tr>
            <th className="px-4 py-3 font-semibold text-gray-600">When</th>
            <th className="px-4 py-3 font-semibold text-gray-600">Platform</th>
            <th className="px-4 py-3 font-semibold text-gray-600">Title</th>
            <th className="px-4 py-3 font-semibold text-gray-600">Type</th>
            <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
            <th className="px-4 py-3 font-semibold text-gray-600 text-right">Views</th>
            <th className="px-4 py-3 font-semibold text-gray-600 text-right">Engagement</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {data.recentPosts.map((p) => {
            const meta = PLATFORM[p.platform] || {};
            const Icon = meta.icon || Share2;
            const eng = (Number(p.likes) || 0) + (Number(p.comments) || 0) + (Number(p.shares) || 0);
            return (
              <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{p.posted_at ? new Date(p.posted_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}</td>
                <td className="px-4 py-3"><Icon size={14} style={{ color: meta.color }} className="inline mr-1" />{meta.label || p.platform}</td>
                <td className="px-4 py-3 font-medium text-gray-900">
                  {p.viral && <span className="mr-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#FCB712] text-[#164FA3]">VIRAL</span>}
                  {p.title || <em className="text-gray-400">(untitled)</em>}
                </td>
                <td className="px-4 py-3"><span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{p.post_type}</span></td>
                <td className="px-4 py-3"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${APPROVAL[p.approval_status]}`}>{p.approval_status}</span></td>
                <td className="px-4 py-3 text-right text-gray-700">{fmt(p.views)}</td>
                <td className="px-4 py-3 text-right text-gray-700">{fmt(eng)}</td>
                <td className="px-4 py-3">
                  <button onClick={() => onEdit(p)} title="Edit post" className="p-1.5 text-gray-400 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg"><Pencil size={13} /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================ PER-LS
function PerLsTab({ data }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left">
          <tr>
            <th className="px-4 py-3 font-semibold text-gray-600">Lok Sabha</th>
            <th className="px-4 py-3 font-semibold text-gray-600 text-right">Pages</th>
            <th className="px-4 py-3 font-semibold text-gray-600 text-right">Followers</th>
            <th className="px-4 py-3 font-semibold text-gray-600 text-right">Posts</th>
            <th className="px-4 py-3 font-semibold text-gray-600 text-right">Total Views</th>
          </tr>
        </thead>
        <tbody>
          {data.perLs.map((r) => (
            <tr key={r.name} className="border-t border-gray-100 hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
              <td className="px-4 py-3 text-right text-gray-700">{r.pages}</td>
              <td className="px-4 py-3 text-right text-gray-700">{fmt(r.followers)}</td>
              <td className="px-4 py-3 text-right text-gray-700">{r.posts}</td>
              <td className="px-4 py-3 text-right text-gray-900 font-bold">{fmt(r.views)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================ NEW POST MODAL
function PostModal({ pages, onClose, onSaved, editing }) {
  const [form, setForm] = useState(editing ? {
    page_id: editing.page_id || "",
    title: editing.title || "",
    caption: editing.caption || "",
    post_type: editing.post_type || "post",
    media_url: editing.media_url || "",
    external_url: editing.external_url || "",
    posted_at: editing.posted_at ? new Date(editing.posted_at).toISOString().slice(0, 16) : "",
    approval_status: editing.approval_status || "pending",
    views: editing.views || 0, likes: editing.likes || 0,
    comments: editing.comments || 0, shares: editing.shares || 0,
    reach: editing.reach || 0,
    viral: editing.viral || 0,
  } : {
    page_id: "", title: "", caption: "", post_type: "post",
    media_url: "", external_url: "", posted_at: new Date().toISOString().slice(0, 16),
    approval_status: "pending",
    views: 0, likes: 0, comments: 0, shares: 0, reach: 0,
  });
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  async function uploadFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setUploading(true);
    const fd = new FormData(); fd.append("file", f);
    const r = await fetch("/api/uploads", { method: "POST", body: fd });
    setUploading(false);
    if (r.ok) setForm({ ...form, media_url: (await r.json()).url });
  }
  async function save() {
    setSaving(true);
    const url = editing ? `/api/social-management/posts/${editing.id}` : "/api/social-management/posts";
    const method = editing ? "PUT" : "POST";
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) onSaved(); else setSaving(false);
  }
  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl p-6 space-y-3 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">{editing ? "Edit Post" : "Log a Post"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <select className={inp} value={form.page_id} onChange={(e) => setForm({ ...form, page_id: e.target.value })}>
          <option value="">Pick a page *</option>
          {pages.map((p) => <option key={p.id} value={p.id}>{p.lok_sabha_name} · {PLATFORM[p.platform]?.label} · {p.handle}</option>)}
        </select>
        <input className={inp} placeholder="Title / topic" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <textarea className={inp} rows={3} placeholder="Caption / description" value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <select className={inp} value={form.post_type} onChange={(e) => setForm({ ...form, post_type: e.target.value })}>
            {POST_TYPE.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="datetime-local" className={inp} value={form.posted_at} onChange={(e) => setForm({ ...form, posted_at: e.target.value })} />
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={uploadFile} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 inline-flex items-center gap-1">
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {form.media_url ? "Replace media" : "Attach media"}
          </button>
          {form.media_url && <a href={form.media_url} target="_blank" rel="noreferrer" className="text-xs text-[#164FA3] hover:underline">Open</a>}
        </div>
        <input className={inp} placeholder="External link (URL of the live post)" value={form.external_url} onChange={(e) => setForm({ ...form, external_url: e.target.value })} />
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-500 text-xs font-semibold uppercase tracking-wide">Add metrics (optional)</summary>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {["views", "likes", "comments", "shares", "reach"].map((m) => (
              <input key={m} type="number" placeholder={m} className={inp} value={form[m]} onChange={(e) => setForm({ ...form, [m]: e.target.value })} />
            ))}
          </div>
        </details>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving || !form.page_id} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : (editing ? "Save" : "Submit for approval")}</button>
        </div>
      </div>
    </div>
  );
}
