"use client";

import { useEffect, useState, useRef } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { canAccessSocial } from "@/lib/permissions";
import {
  Share2, Loader2, Plus, X, Upload, CheckCircle2, XCircle,
  Clock, ThumbsUp, Camera, ChevronRight, FileText, Pencil,
  Bird,
} from "lucide-react";
import SocialDashboardTab from "@/components/social/SocialDashboardTab";
import ProfilePhoto from "@/components/ProfilePhoto";
import Avatar from "@/components/Avatar";
import FollowersMondayReminder from "@/components/social/FollowersMondayReminder";

// The Social Media Master supports exactly these three networks (kept in sync
// with ALLOWED_PLATFORMS in the pages API and the social_pages.platform enum).
// Adding a further platform later is one more entry here (icon + brand color)
// plus one more allowed value server-side — no other redesign needed.
const PLATFORM = {
  facebook:  { label: "Facebook",  icon: ThumbsUp,      color: "#1877F2" },
  instagram: { label: "Instagram", icon: Camera,        color: "#E4405F" },
  twitter:   { label: "Twitter/X", icon: Bird,          color: "#000000" },
};
// A page has NOT completed today's post when its live today_posts count (from
// Log a Post, dated to today) is 0 → drives the RED "pending" state (PROMPT 9).
// Derived from the actual DB count, never a manually set flag; the moment a
// valid post is logged today the count becomes > 0 and the page returns to
// normal on the next refetch.
const noPostToday = (p) => !(Number(p?.today_posts) > 0);

const POST_TYPE = ["post", "reel", "story", "video", "poster"];
// Log a Post (BUG 2) exposes exactly these three post types.
const LOG_POST_TYPES = [["photo", "Photo"], ["video", "Video"], ["reel", "Reel"]];
// Content is unlimited long-form text — NO word/character maximum and no
// minimum beyond being non-empty (1 word through 10,000+ words are all valid).
const isValidUrl = (s) => { try { const u = new URL(String(s).trim()); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; } };
const APPROVAL = {
  draft:    "bg-gray-100 text-gray-500",
  pending:  "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

// Dashboard and Overview are merged into ONE unified section (PROMPT 6): the
// "Dashboard" tab renders the dashboard metrics followed by the overview
// panels. No separate Overview tab.
const TABS = [
  { k: "dashboard", l: "Dashboard" },
  { k: "pages", l: "Pages" },
  { k: "approvals", l: "Approvals" },
  { k: "log", l: "Post Log" },
];

export default function Page() {
  return <SupervisorGuard allow={canAccessSocial}><Body /></SupervisorGuard>;
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
  const [tab, setTab] = useState("dashboard");
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
      {/* Monday "update Followers" reminder — Social users/admins only (this
          page is already gated to them), once per Monday. */}
      <FollowersMondayReminder />
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Social Media Command Center</h1>
          <p className="text-gray-500 mt-2 font-medium">Manual logging only — team posts on each platform, then logs it here. <span className="text-amber-600">Platform API integration not enabled.</span></p>
        </div>
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-md">
          <Plus size={16} /> Log a Post
        </button>
      </div>

      {/* Search cards (PROMPT 5) — exactly four, all from live DB records:
          today's FB/IG post counts (from logged posts) and FB/IG follower
          totals (from the pages' Followers Master). */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Today's Total Post — Facebook" value={fmt(o.fb_today_posts || 0)} accent />
        <Kpi label="Today's Total Post — Instagram" value={fmt(o.ig_today_posts || 0)} accent />
        <Kpi label="Facebook Total Followers" value={fmt(o.fb_followers || 0)} />
        <Kpi label="Instagram Total Followers" value={fmt(o.ig_followers || 0)} />
      </div>

      <div className="flex gap-2 flex-wrap border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${tab === t.k ? "border-[#164FA3] text-[#164FA3]" : "border-transparent text-gray-500 hover:text-gray-700"}`}>{t.l}</button>
        ))}
      </div>

      {/* Unified Dashboard / Overview (PROMPT 6) — dashboard metrics + overview
          panels in one section. "overview" is accepted as a fallback so any old
          deep-link lands on the same unified view instead of a blank tab. */}
      {(tab === "dashboard" || tab === "overview") && (
        <div className="space-y-6">
          <SocialDashboardTab PLATFORM={PLATFORM} />
          <OverviewTab data={data} />
        </div>
      )}
      {tab === "pages"     && <PagesTab data={data} onReload={load} />}
      {tab === "approvals" && <ApprovalsTab data={data} setStatus={setStatus} onEdit={setEditing} />}
      {tab === "log"       && <LogTab data={data} onEdit={setEditing} />}

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
// Unified Overview (PROMPT 7): exactly three platform columns — Instagram,
// Facebook, Twitter/X — each listing its registered Pages straight from the
// Social Media Pages Master (data.pages, i.e. social_pages). Counts (e.g. the
// "11" Instagram/Facebook pages) are derived live from the fetched rows, never
// hardcoded: add a page and it appears here, remove one and it's gone. Only the
// three supported platforms are shown; LinkedIn/WhatsApp/Telegram cannot appear
// because they aren't in PLATFORM and aren't allowed in social_pages.
const OVERVIEW_ORDER = ["instagram", "facebook", "twitter"];

function OverviewTab({ data }) {
  const columns = OVERVIEW_ORDER.filter((k) => PLATFORM[k]).map((key) => {
    const pages = data.pages.filter((p) => p.platform === key);
    const followers = pages.reduce((s, p) => s + (Number(p.followers) || 0), 0);
    return { key, meta: PLATFORM[key], pages, followers };
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {columns.map(({ key, meta, pages, followers }) => {
        const Icon = meta.icon;
        return (
          <div key={key} className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col">
            {/* Column header — platform + live page count + total followers */}
            <div className="flex items-center gap-2.5 p-4 border-b border-gray-100">
              <span className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: meta.color }}><Icon size={18} /></span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-gray-900">{meta.label}</div>
                <div className="text-xs text-gray-400">{pages.length} page{pages.length === 1 ? "" : "s"} · {fmt(followers)} followers</div>
              </div>
            </div>
            {/* Registered pages for this platform */}
            <div className="p-3 space-y-2 max-h-[560px] overflow-auto">
              {pages.length === 0 ? (
                <div className="text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl p-4 text-center">No {meta.label} pages yet.</div>
              ) : pages.map((p) => (
                <div key={p.id} className="flex items-center gap-2.5 rounded-xl border border-gray-100 px-3 py-2 hover:bg-gray-50">
                  {p.photo_url ? (
                    <Avatar name={p.handle} src={p.photo_url} size={34} square className="border border-gray-200 shrink-0" />
                  ) : (
                    <span className="w-[34px] h-[34px] rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: meta.color }}><Icon size={15} /></span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`font-semibold text-sm truncate flex items-center gap-1.5 ${noPostToday(p) ? "text-red-600" : "text-gray-900"}`}>
                      {noPostToday(p) && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="Today's post not completed" />}
                      <span className="truncate">{p.handle}</span>
                    </div>
                    <div className={`text-xs truncate ${noPostToday(p) ? "text-red-500 font-medium" : "text-gray-400"}`}>
                      {noPostToday(p) ? "Today's post not completed" : (p.lok_sabha_name || "—")}
                    </div>
                  </div>
                  <div className="flex items-stretch gap-3 shrink-0 text-right">
                    <div>
                      <div className="text-sm font-bold text-gray-900">{fmt(p.followers)}</div>
                      <div className="text-[10px] text-gray-400 uppercase tracking-wide">Followers</div>
                    </div>
                    <div className="border-l border-gray-100 pl-3">
                      <div className="text-sm font-bold text-gray-900">{p.today_posts ?? 0}</div>
                      <div className="text-[10px] text-gray-400 uppercase tracking-wide whitespace-nowrap">Today's Posts</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================ PAGES
// Social Media Master (BUG 1). Pages are grouped by platform (Facebook /
// Instagram / Twitter-X) with an Add Page action. Page names are stored in the
// social_pages table (handle) — the single source of truth every page-name
// dropdown across the module reads from; nothing is hardcoded.
function PagesTab({ data, onReload }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const pages = data.pages || [];
  // Order the platform groups by the master PLATFORM map so all three always
  // show (even with zero pages), and each supports any number of pages (≥20).
  const groups = Object.keys(PLATFORM).map((key) => ({
    key,
    meta: PLATFORM[key],
    items: pages.filter((p) => p.platform === key),
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-gray-900">Social Media Master · Pages</h3>
          <p className="text-sm text-gray-500">Add and manage pages per platform. Page names are saved in the database and used everywhere a page is selected.</p>
        </div>
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3.5 py-2 rounded-lg text-sm font-semibold"><Plus size={15} /> Add Page</button>
      </div>

      {groups.map(({ key, meta, items }) => {
        const Icon = meta.icon;
        return (
          <div key={key}>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-6 h-6 rounded-md flex items-center justify-center text-white" style={{ background: meta.color }}><Icon size={13} /></span>
              <h4 className="font-semibold text-gray-800 text-sm">{meta.label}</h4>
              <span className="text-xs text-gray-400">({items.length})</span>
            </div>
            {items.length === 0 ? (
              <div className="text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl p-4">No {meta.label} pages yet — click “Add Page”.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((p) => (
                  <div key={p.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 group">
                    <div className="flex items-center gap-2 mb-3">
                      {/* DP thumbnail when the page has one, else the platform badge. */}
                      {p.photo_url ? (
                        <div className="relative shrink-0">
                          <Avatar name={p.handle} src={p.photo_url} size={36} square className="border border-gray-200" />
                          <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-white ring-2 ring-white" style={{ background: meta.color }}><Icon size={9} /></span>
                        </div>
                      ) : (
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: meta.color }}><Icon size={16} /></div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className={`font-bold text-sm truncate flex items-center gap-1.5 ${noPostToday(p) ? "text-red-600" : "text-gray-900"}`}>
                          {noPostToday(p) && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="Today's post not completed" />}
                          <span className="truncate">{p.handle}</span>
                        </div>
                        <div className={`text-xs truncate ${noPostToday(p) ? "text-red-500 font-medium" : "text-gray-500"}`}>
                          {noPostToday(p) ? "Today's post not completed" : (p.lok_sabha_name || "—")}
                        </div>
                      </div>
                      <button onClick={() => setEditing(p)} title="Edit page / followers" className="p-1.5 text-gray-300 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg opacity-0 group-hover:opacity-100"><Pencil size={13} /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><div className="text-gray-400">Total Followers</div><div className="font-bold text-gray-900">{fmt(p.followers)}</div></div>
                      <div><div className="text-gray-400">Today's Posts</div><div className="font-bold text-gray-900">{p.today_posts ?? 0}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {adding && <PageModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); onReload?.(); }} />}
      {editing && <PageModal editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onReload?.(); }} />}
    </div>
  );
}

// Add / Edit a page in the Social Media Master: platform + page name +
// Followers (the admin follower-update mechanism, BUG 4). Add → POST, Edit →
// PUT /api/social-management/pages/[id]. Duplicate names per platform are
// rejected server-side.
function PageModal({ onClose, onSaved, editing }) {
  const isEdit = !!editing?.id;
  const [platform, setPlatform] = useState(editing?.platform || "facebook");
  const [handle, setHandle] = useState(editing?.handle || "");
  const [followers, setFollowers] = useState(editing?.followers != null ? String(editing.followers) : "0");
  // DP (page photo). ProfilePhoto uploads the bytes to the durable store
  // (/api/uploads) as soon as the user picks/crops one and hands back a
  // permanent URL; Remove sets it back to null. The chosen value is persisted
  // to social_pages.photo_url when the page is saved below.
  const [photoUrl, setPhotoUrl] = useState(editing?.photo_url || null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    if (saving) return;
    const name = handle.replace(/\s+/g, " ").trim();
    if (!name) { setErr("Page name is required."); return; }
    const fol = Math.max(0, Math.floor(Number(followers) || 0));
    setSaving(true); setErr("");
    try {
      const url = isEdit ? `/api/social-management/pages/${editing.id}` : "/api/social-management/pages";
      const method = isEdit ? "PUT" : "POST";
      const r = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        // Always send photo_url so a changed DP is saved, a removed DP (null)
        // clears only that column, and an untouched DP is preserved on edit.
        body: JSON.stringify({ platform, handle: name, followers: fol, photo_url: photoUrl ?? null }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.message || "Could not save the page.");
      onSaved();
    } catch (e) { setErr(e.message); setSaving(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900">{isEdit ? "Edit Page" : "Add Page"}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        {/* Page DP — upload / change / remove. The current DP is shown when
            editing; the "+" menu offers Upload / Take Photo / View / Remove. */}
        <div className="flex flex-col items-center gap-1.5">
          <ProfilePhoto
            name={handle || "Page"}
            src={photoUrl}
            size={84}
            square
            onChange={(u) => setPhotoUrl(u || null)}
          />
          <span className="text-[11px] text-gray-400">{photoUrl ? "Page DP — use “+” to change or remove" : "Add a page DP (optional)"}</span>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Platform *</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-[#164FA3]/30">
            {Object.keys(PLATFORM).map((k) => <option key={k} value={k}>{PLATFORM[k].label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Page Name *</label>
          <input autoFocus value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="e.g. AAP Raipur Official" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-[#164FA3]/30" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Followers</label>
          <input type="number" min="0" value={followers} onChange={(e) => setFollowers(e.target.value)} placeholder="0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-[#164FA3]/30" />
          <p className="text-[11px] text-gray-400 mt-1">Used by the dashboard follower totals (summed per platform).</p>
        </div>
        {err && <div className="text-sm text-red-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-100">Cancel</button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60">
            {saving && <Loader2 size={15} className="animate-spin" />} Save
          </button>
        </div>
      </div>
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
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-4 py-3 font-semibold text-gray-600">Content</th>
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
                  <td className="px-4 py-3 text-gray-700 max-w-[24rem]"><div className="text-xs whitespace-pre-wrap break-words max-h-32 overflow-y-auto">{p.caption || <em className="text-gray-400">(no content)</em>}</div></td>
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
        </div>
      )}
    </div>
  );
}

// ============================================================ LOG
// The local date (YYYY-MM-DD) of a post's actual DB Date & Time (posted_at,
// falling back to created_at) — used by the date filter so a selected calendar
// date matches the real stored timestamp.
function postDateKey(p) {
  const v = p.posted_at || p.created_at;
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

function LogTab({ data, onEdit }) {
  const posts = data.recentPosts || [];
  const [date, setDate] = useState("");     // "" = all dates
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("");

  const needle = q.trim().toLowerCase();
  // All filtering runs over the real post records (posted_at / caption / handle),
  // never a separate list — same rows Log a Post created.
  const shown = posts.filter((p) => {
    if (date && postDateKey(p) !== date) return false;
    if (platform && p.platform !== platform) return false;
    if (needle && !`${p.title || ""} ${p.caption || ""} ${p.handle || ""} ${p.lok_sabha_name || ""}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      {/* Filter bar — pinned above the list; a calendar date filter over the
          actual DB Date & Time, plus platform + text search. */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 inline-flex items-center gap-1"><Clock size={13} /> Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]/30" />
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]/30">
          <option value="">All platforms</option>
          {Object.keys(PLATFORM).map((k) => <option key={k} value={k}>{PLATFORM[k].label}</option>)}
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search content / page…" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]/30" />
        </div>
        <span className="text-xs text-gray-500">{shown.length} post{shown.length === 1 ? "" : "s"}</span>
        {(date || platform || needle) && (
          <button onClick={() => { setDate(""); setPlatform(""); setQ(""); }} className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"><X size={13} /> Clear</button>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Date &amp; Time</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Platform</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Page</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Content</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Post Access</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Type</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Link</th>
              <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">{posts.length === 0 ? "No posts yet — use “Log a Post”." : "No posts match the selected filters."}</td></tr>
            ) : shown.map((p) => {
              const meta = PLATFORM[p.platform] || {};
              const Icon = meta.icon || Share2;
              const scheduled = p.publish_status === "scheduled";
              return (
                <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50 align-top">
                  <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">{fmtDateTime(p.posted_at || p.created_at)}</td>
                  <td className="px-4 py-3 whitespace-nowrap"><Icon size={14} style={{ color: meta.color }} className="inline mr-1" />{meta.label || p.platform}</td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{p.handle || "—"}</td>
                  <td className="px-4 py-3 text-gray-700 max-w-[22rem]">
                    {/* Full content, never truncated — line breaks/formatting
                        preserved; a very long post scrolls within the cell. */}
                    <div className="text-xs text-gray-600 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{p.caption || <span className="text-gray-300">(no content)</span>}</div>
                  </td>
                  <td className="px-4 py-3">
                    {p.media_url ? (
                      <a href={p.media_url} target="_blank" rel="noreferrer" title="Open screenshot"><img src={p.media_url} alt="" className="w-10 h-10 rounded object-cover border border-gray-200" /></a>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3"><span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{p.post_type}</span></td>
                  <td className="px-4 py-3">
                    {p.external_url ? <a href={p.external_url} target="_blank" rel="noreferrer" className="text-[#164FA3] hover:underline text-xs inline-flex items-center gap-1"><ChevronRight size={12} /> Open</a> : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full ${scheduled ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{scheduled ? "Scheduled" : "Published"}</span>
                    {p.approval_status && p.approval_status !== "approved" && (
                      <span className={`ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${APPROVAL[p.approval_status] || "bg-gray-100 text-gray-500"}`}>{p.approval_status}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => onEdit(p)} title="Edit / view post" className="p-1.5 text-gray-400 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg"><Pencil size={13} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================ PER-LS

// ============================================================ LOG A POST MODAL
// Platform → Page (filtered) → Content (primary field, unlimited long-form text,
// no word/char limit) → Date/Time → Screenshot (durable upload) → Post Type →
// Link (URL-validated) → Status (Publish/Schedule). The complete record is saved
// to social_posts (caption is LONGTEXT, never truncated); the screenshot goes
// through /api/uploads (durable DB-backed store) so it survives refresh/redeploy.
// Guarded against duplicate submits.
function PostModal({ pages, onClose, onSaved, editing }) {
  const allPages = pages || [];
  // On edit, seed the platform from the post's page so the page dropdown filters
  // correctly and the saved page stays selected.
  const editingPage = editing ? allPages.find((p) => String(p.id) === String(editing.page_id)) : null;
  const [platform, setPlatform] = useState(editingPage?.platform || "facebook");
  const [form, setForm] = useState(editing ? {
    page_id: editing.page_id || "",
    caption: editing.caption || "",
    post_type: editing.post_type || "photo",
    media_url: editing.media_url || "",
    external_url: editing.external_url || "",
    posted_at: editing.posted_at ? new Date(editing.posted_at).toISOString().slice(0, 16) : "",
    approval_status: editing.approval_status || "pending",
    publish_status: editing.publish_status === "scheduled" ? "scheduled" : "published",
    views: editing.views || 0, likes: editing.likes || 0,
    comments: editing.comments || 0, shares: editing.shares || 0,
    reach: editing.reach || 0,
    viral: editing.viral || 0,
  } : {
    page_id: "", caption: "", post_type: "photo",
    media_url: "", external_url: "", posted_at: new Date().toISOString().slice(0, 16),
    approval_status: "pending",
    publish_status: "published",
    views: 0, likes: 0, comments: 0, shares: 0, reach: 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  // Pages belonging to the chosen platform only (dynamic dropdown).
  const platformPages = allPages.filter((p) => p.platform === platform);
  // Content is the primary field: required (non-empty) but with NO word/char
  // limit — 1 word or 10,000+ words are equally valid.
  const contentOk = form.caption.trim().length > 0;
  const linkOk = !form.external_url.trim() || isValidUrl(form.external_url);

  function changePlatform(next) {
    setPlatform(next);
    // Clear the selected page if it no longer belongs to the new platform.
    const stillValid = allPages.some((p) => String(p.id) === String(form.page_id) && p.platform === next);
    if (!stillValid) setForm((f) => ({ ...f, page_id: "" }));
  }

  async function uploadFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    if (e.target) e.target.value = "";
    setUploading(true); setError("");
    try {
      const fd = new FormData(); fd.append("file", f);
      const r = await fetch("/api/uploads", { method: "POST", body: fd });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.message || "Screenshot upload failed.");
      setForm((prev) => ({ ...prev, media_url: b.url }));
    } catch (e2) { setError(e2.message || "Screenshot upload failed."); }
    finally { setUploading(false); }
  }

  async function save() {
    if (saving) return; // guard against a double Submit creating duplicate posts
    setError(""); setOk("");
    if (!form.page_id) { setError("Select a platform and page."); return; }
    if (!contentOk) { setError("Content is required."); return; }
    if (!String(form.posted_at).trim()) { setError("Date & time is required."); return; }
    if (!linkOk) { setError("Enter a valid URL (starting with http:// or https://) for the link."); return; }
    setSaving(true);
    // Status: Publish = published now; Schedule = scheduled_at holds the chosen time.
    const payload = {
      ...form,
      scheduled_at: form.publish_status === "scheduled" ? form.posted_at : null,
    };
    try {
      const url = editing ? `/api/social-management/posts/${editing.id}` : "/api/social-management/posts";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.message || "Could not save the post.");
      setOk("Saved.");
      onSaved();
    } catch (e) { setError(e.message || "Could not save the post."); setSaving(false); }
  }
  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
  const lbl = "block text-xs font-semibold text-gray-500 mb-1";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl p-6 space-y-3 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">{editing ? "Edit Post" : "Log a Post"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Platform *</label>
            <select className={inp} value={platform} onChange={(e) => changePlatform(e.target.value)}>
              {Object.keys(PLATFORM).map((k) => <option key={k} value={k}>{PLATFORM[k].label}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Page Name *</label>
            <select className={inp} value={form.page_id} onChange={(e) => setForm({ ...form, page_id: e.target.value })}>
              <option value="">{platformPages.length ? "Select a page" : "No pages for this platform"}</option>
              {platformPages.map((p) => <option key={p.id} value={p.id}>{p.handle}{p.lok_sabha_name ? ` · ${p.lok_sabha_name}` : ""}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={lbl}>Content *</label>
          <textarea className={inp} rows={8} placeholder="Write the full post content… (no length limit)" value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Post Type</label>
            <select className={inp} value={form.post_type} onChange={(e) => setForm({ ...form, post_type: e.target.value })}>
              {LOG_POST_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Date &amp; Time *</label>
            <input type="datetime-local" className={inp} value={form.posted_at} onChange={(e) => setForm({ ...form, posted_at: e.target.value })} />
          </div>
        </div>

        <div>
          <label className={lbl}>Status</label>
          <select className={inp} value={form.publish_status} onChange={(e) => setForm({ ...form, publish_status: e.target.value })}>
            <option value="published">Publish (immediate)</option>
            <option value="scheduled">Schedule</option>
          </select>
        </div>

        <div>
          <label className={lbl}>Screenshot</label>
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={uploadFile} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 inline-flex items-center gap-1 disabled:opacity-50">
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {form.media_url ? "Replace screenshot" : "Upload screenshot"}
            </button>
            {form.media_url && (
              <span className="inline-flex items-center gap-2">
                <img src={form.media_url} alt="" className="w-10 h-10 rounded object-cover border border-gray-200" />
                <a href={form.media_url} target="_blank" rel="noreferrer" className="text-xs text-[#164FA3] hover:underline">Open</a>
                <button type="button" onClick={() => setForm({ ...form, media_url: "" })} className="text-gray-400 hover:text-red-500"><X size={13} /></button>
              </span>
            )}
          </div>
        </div>

        <div>
          <label className={lbl}>Link <span className="text-gray-400 font-normal">(URL of the live post)</span></label>
          <input className={`${inp} ${form.external_url && !linkOk ? "border-red-400 focus:ring-red-200" : ""}`} placeholder="https://…" value={form.external_url} onChange={(e) => setForm({ ...form, external_url: e.target.value })} />
          {form.external_url && !linkOk && <div className="text-[11px] text-red-600 mt-1">Enter a valid URL starting with http:// or https://</div>}
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-gray-500 text-xs font-semibold uppercase tracking-wide">Add metrics (optional)</summary>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {["views", "likes", "comments", "shares", "reach"].map((m) => (
              <input key={m} type="number" placeholder={m} className={inp} value={form[m]} onChange={(e) => setForm({ ...form, [m]: e.target.value })} />
            ))}
          </div>
        </details>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        {ok && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{ok}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving || uploading || !form.page_id || !contentOk} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : (editing ? "Save" : "Submit")}</button>
        </div>
      </div>
    </div>
  );
}
