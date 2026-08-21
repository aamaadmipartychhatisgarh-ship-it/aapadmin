"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { canAccessMedia } from "@/lib/permissions";
import {
  LayoutDashboard, Newspaper, Tv, Mic, UserCheck, BarChart3, Upload, Plus, Loader2, X,
  Calendar, FileText, MessageCircle, CheckCircle2, TrendingUp, Eye, Pencil, ChevronDown, Check,
} from "lucide-react";
import MediaDashboardTab from "@/components/media/MediaDashboardTab";
import FloatingPopover from "@/components/FloatingPopover";
import Avatar from "@/components/Avatar";
import { useRouter } from "next/navigation";

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
  // Global Media Center date filter — kept at this level so it PERSISTS while
  // switching tabs (item 8) and drives the shared /api/media fetch (items 3–5).
  const [dateFilter, setDateFilter] = useState({ time: "all", from: "", to: "" });

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3500); return () => clearTimeout(t); }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (dateFilter.time && dateFilter.time !== "all") {
      qs.set("time", dateFilter.time);
      if (dateFilter.time === "custom") {
        // Single "Custom Date" = one of the two inputs; "Custom Date Range" =
        // both. Mirror a lone date to both bounds so it means that single day.
        const from = dateFilter.from || dateFilter.to;
        const to = dateFilter.to || dateFilter.from;
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
      }
    }
    const r = await fetch(`/api/media${qs.toString() ? `?${qs}` : ""}`);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }, [dateFilter]);

  useEffect(() => { load(); }, [load]);

  const filterActive = dateFilter.time !== "all";

  if (loading && !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  if (!data) return <div className="p-8 text-center text-gray-400">Couldn&apos;t load the Media Center.</div>;

  // The date filter governs the date-based sections (coverage, debates,
  // conferences, analytics). It's hidden on the Dashboard ("Yesterday's
  // Performance", period-fixed) and the Spokespersons master tab, which aren't
  // date-scoped. The Channels tab hosts the Debates list, so it's included.
  const showFilter = ["newspapers", "channels", "conferences", "analytics"].includes(tab);

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

      {showFilter && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
          <MediaDateFilter value={dateFilter} onChange={setDateFilter} loading={loading} />
        </div>
      )}

      {tab === "dashboard" && <MediaDashboardTab onOpenTab={setTab} />}
      {tab === "newspapers" && <NewspapersTab data={data} onChange={load} flash={setToast} filtered={filterActive} />}
      {tab === "channels" && <ChannelsTab data={data} onChange={load} flash={setToast} filtered={filterActive} />}
      {tab === "conferences" && <ConferencesTab data={data} onChange={load} filtered={filterActive} />}
      {tab === "spokespersons" && <SpokespersonsTab data={data} onChange={load} />}
      {tab === "analytics" && <AnalyticsTab data={data} filtered={filterActive} />}
    </div>
  );
}

// Preset labels mirror src/lib/reports/timeRanges + the two "custom" modes.
const MEDIA_PRESETS = [
  { k: "all", l: "All dates" },
  { k: "today", l: "Today" },
  { k: "yesterday", l: "Yesterday" },
  { k: "this_week", l: "This Week" },
  { k: "this_month", l: "This Month" },
  { k: "custom", l: "Custom" },
];

// Global date filter control: preset chips + a custom from/to range. Filtering
// runs server-side against the real DB date columns (see /api/media); this only
// picks the range. Selecting a preset highlights it (active filter shown), and a
// Clear button resets to "All dates".
function MediaDateFilter({ value, onChange, loading }) {
  const active = value.time !== "all";
  const pick = (k) => onChange(k === "custom"
    ? { time: "custom", from: value.from || "", to: value.to || "" }
    : { time: k, from: "", to: "" });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1"><Calendar size={13} /> Date</span>
      {MEDIA_PRESETS.map((p) => (
        <button
          key={p.k}
          onClick={() => pick(p.k)}
          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${value.time === p.k ? "bg-[#164FA3] text-white border-[#164FA3]" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
        >
          {p.l}
        </button>
      ))}
      {value.time === "custom" && (
        <span className="flex items-center gap-1.5">
          <input type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-[#164FA3]" />
          <span className="text-gray-400 text-xs">to</span>
          <input type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} className="border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-[#164FA3]" />
        </span>
      )}
      {loading && <Loader2 size={14} className="animate-spin text-[#164FA3]" />}
      {active && (
        <button onClick={() => onChange({ time: "all", from: "", to: "" })} className="ml-auto text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1">
          <X size={12} /> Clear filter
        </button>
      )}
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
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [showAddNewspaper, setShowAddNewspaper] = useState(false);
  const [uploadFor, setUploadFor] = useState(null); // newspaper id to pre-select on Upload
  // Dedicated Lok Sabha-wise search over the newspaper cards. "" = no filter;
  // "__all__" = papers mapped to All Lok Sabha; otherwise a specific Lok Sabha id.
  const [lokSearch, setLokSearch] = useState("");
  const [lokOptions, setLokOptions] = useState([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/locations?type=lok_sabha")
      .then((r) => (r.ok ? r.json() : { locations: [] }))
      .then((d) => { if (alive) setLokOptions(d.locations || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Open the upload flow pre-associated with this newspaper.
  const uploadForNewspaper = (np) => { setUploadFor(np.id); setShowAdd(true); };
  // Published List opens a DEDICATED page for that newspaper (by its ID), not an
  // inline section below the cards.
  const viewListFor = (np) => router.push(`/dashboard/media/newspapers/${np.id}/published-list`);

  // Filter the cards by the selected Lok Sabha using the ID relationship (never
  // the display name). No new list is created — the same cards are filtered.
  const allCards = data.newspaperStats || [];
  const shownCards = allCards.filter((np) => {
    if (!lokSearch) return true;
    if (lokSearch === "__all__") return !!np.lok_sabha_all;
    return String(np.lok_sabha_id || "") === String(lokSearch);
  });
  const selectedLokName = lokSearch === "__all__" ? "All Lok Sabha (constituency-wide)" : (lokOptions.find((o) => String(o.id) === String(lokSearch))?.name || "");

  return (
    <div className="space-y-6">
      {/* Newspaper master — add a newspaper (with its Lok Sabha mapping). */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-gray-900">Newspapers</h3>
          <p className="text-sm text-gray-500">Every newspaper uses the same card: name, Lok Sabha, total published, and Upload / Published List.</p>
        </div>
        <button onClick={() => setShowAddNewspaper(true)} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3.5 py-2 rounded-lg text-sm font-semibold">
          <Plus size={15} /> Add Newspaper
        </button>
      </div>

      {/* Dedicated Lok Sabha-wise search — separate from the cards. Options are
          fetched live from the Lok Sabha Master (nothing hardcoded). */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5"><Search size={15} className="text-[#164FA3]" /> Lok Sabha Search</span>
          <select value={lokSearch} onChange={(e) => setLokSearch(e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3] min-w-[200px]">
            <option value="">All Lok Sabha (show all)</option>
            <option value="__all__">All (constituency-wide papers)</option>
            {lokOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {lokSearch && (
            <>
              <span className="text-xs text-gray-500">Showing newspapers mapped to <span className="font-semibold text-[#164FA3]">{selectedLokName || "—"}</span> ({shownCards.length})</span>
              <button onClick={() => setLokSearch("")} className="text-sm text-gray-500 hover:text-red-600 inline-flex items-center gap-1 ml-auto"><X size={14} /> Clear</button>
            </>
          )}
        </div>
      </div>

      {/* One reusable NewspaperCard per newspaper. "Published List" navigates to a
          dedicated per-newspaper page; nothing renders inline below the cards. */}
      {shownCards.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
          {allCards.length === 0 ? "No newspapers yet — add one above." : "No newspapers are mapped to the selected Lok Sabha."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {shownCards.map((np) => (
            <NewspaperCard key={np.id} np={np} onUpload={uploadForNewspaper} onViewList={viewListFor} />
          ))}
        </div>
      )}

      {showAdd && <PressNoteModal newspapers={data.newspapers} defaultNewspaperId={uploadFor} onClose={() => { setShowAdd(false); setUploadFor(null); }} onSaved={(msg) => { setShowAdd(false); setUploadFor(null); onChange(); flash?.(msg); }} />}
      {showAddNewspaper && <NewspaperModal onClose={() => setShowAddNewspaper(false)} onSaved={(msg) => { setShowAddNewspaper(false); onChange(); flash?.(msg); }} />}
    </div>
  );
}

// Add Newspaper — name + Lok Sabha mapping. The Lok Sabha options are fetched
// live from the existing Lok Sabha Master (GET /api/locations?type=lok_sabha) —
// the single source of truth — so updates to that master flow through here
// automatically; nothing is hardcoded. An "All" option maps the newspaper to
// every constituency (stored as a flag, not a fake Lok Sabha row).
function NewspaperModal({ onClose, onSaved }) {
  const [name, setName] = useState("");
  const [lokSabha, setLokSabha] = useState(""); // "" | "all" | "<id>"
  const [options, setOptions] = useState([]);
  const [loadingLs, setLoadingLs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/locations?type=lok_sabha")
      .then((r) => (r.ok ? r.json() : { locations: [] }))
      .then((d) => { if (alive) setOptions(d.locations || []); })
      .catch(() => { if (alive) setError("Couldn't load the Lok Sabha list. Please try again."); })
      .finally(() => { if (alive) setLoadingLs(false); });
    return () => { alive = false; };
  }, []);

  async function save() {
    if (saving) return;
    const clean = name.trim();
    if (!clean) { setError("Newspaper name is required."); return; }
    if (!lokSabha) { setError("Please select a Lok Sabha (or choose “All”)."); return; }
    setSaving(true); setError("");
    const body = lokSabha === "all"
      ? { name: clean, lok_sabha_all: true }
      : { name: clean, lok_sabha_id: Number(lokSabha) };
    try {
      const r = await fetch("/api/media/newspapers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.message || "Could not add the newspaper."); setSaving(false); return; }
      onSaved("Newspaper added successfully.");
    } catch {
      setError("Could not add the newspaper. Please try again.");
      setSaving(false);
    }
  }

  return (
    <Modal title="Add Newspaper" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Newspaper Name <span className="text-red-500">*</span></label>
          <input autoFocus className={inp} value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="e.g. Dainik Bhaskar" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Lok Sabha <span className="text-red-500">*</span></label>
          <select className={inp} value={lokSabha} onChange={(e) => { setLokSabha(e.target.value); setError(""); }} disabled={loadingLs}>
            <option value="">{loadingLs ? "Loading…" : "— select Lok Sabha —"}</option>
            <option value="all">All (applies to all Lok Sabha)</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">Sourced live from the Lok Sabha Master.</p>
        </div>
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold inline-flex items-center gap-2">{saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : "Add Newspaper"}</button>
        </div>
      </div>
    </Modal>
  );
}

function SentimentBadge({ s }) {
  if (!s) return <span className="text-gray-300 text-xs">—</span>;
  const map = { positive: "bg-emerald-100 text-emerald-700", neutral: "bg-gray-100 text-gray-600", negative: "bg-red-100 text-red-700" };
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${map[s]}`}>{s}</span>;
}

// ONE reusable card for EVERY newspaper — identical design, layout, structure and
// actions for all newspapers (no per-newspaper variants). Contains: Newspaper
// Name, Lok Sabha Name, Total Published (live DB count), and Upload / Published
// List actions. `np` comes from newspaperStats (real DB record: id, name,
// lok_sabha_all, lok_sabha_name, total).
function NewspaperCard({ np, onUpload, onViewList }) {
  const lokSabha = np.lok_sabha_all ? "All Lok Sabha" : (np.lok_sabha_name || "—");
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center shrink-0"><Newspaper size={15} /></div>
        <div className="min-w-0">
          <div className="font-bold text-gray-900 text-sm truncate" title={np.name}>{np.name}</div>
          <div className="text-[11px] font-medium text-gray-400 truncate" title={lokSabha}>{lokSabha}</div>
        </div>
      </div>
      <div className="rounded-xl bg-gray-50 px-3 py-2">
        <div className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{Number(np.total) || 0}</div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mt-1">Total Published</div>
      </div>
      <div className="mt-auto flex items-center gap-2">
        <button onClick={() => onUpload(np)} className="flex-1 inline-flex items-center justify-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3 py-2 rounded-lg text-xs font-semibold"><Upload size={13} /> Upload</button>
        <button onClick={() => onViewList(np)} className="flex-1 inline-flex items-center justify-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg text-xs font-semibold"><FileText size={13} /> Published List</button>
      </div>
    </div>
  );
}

// Consistent Newspaper-module date format, e.g. "20 Aug 2026". Uses the saved DB
// date (YYYY-MM-DD or a datetime); returns "—" when absent/invalid.
function fmtNewsDate(v) {
  if (!v) return "—";
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
// Newspaper cutting thumbnail. Shows the actual uploaded image (object-contain →
// aspect ratio kept, never stretched) in a consistent container; clicking opens a
// full-size lightbox. A non-image file (e.g. PDF) opens in a new tab. When no
// image exists, a proper newspaper icon is shown — never a tiny generic file icon.
function NewspaperPhoto({ url, title, onPreview }) {
  const box = "w-16 h-20 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0";
  if (url && IMAGE_RE.test(String(url).split("?")[0])) {
    return (
      <button type="button" onClick={() => onPreview?.(url)} className={`${box} hover:ring-2 hover:ring-[#164FA3]/40`} title="View full newspaper cutting">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={title || "Newspaper cutting"} loading="lazy" decoding="async" className="w-full h-full object-contain" />
      </button>
    );
  }
  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={`${box} text-[#164FA3] hover:ring-2 hover:ring-[#164FA3]/40`} title="Open uploaded file">
        <Newspaper size={26} />
      </a>
    );
  }
  return <div className={`${box} text-gray-300`} title="No newspaper image"><Newspaper size={26} /></div>;
}

// A clock that re-renders on an interval, so proximity-based colours track the
// real remaining time without a manual refresh (item 5). Defaults to 60s.
function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}
// Combine a debate's saved date + time into a real Date (local). Missing time
// defaults to midday so a date-only debate still sorts sensibly.
function debateStart(d) {
  if (!d?.debate_date) return null;
  const date = String(d.debate_date).slice(0, 10);
  let time = d.debate_time ? String(d.debate_time).slice(0, 8) : "12:00:00";
  if (time.length === 5) time += ":00";
  const dt = new Date(`${date}T${time}`);
  return isNaN(dt.getTime()) ? null : dt;
}
// Nearest upcoming (or currently live) debate for a channel, plus how many more
// are queued. Cancelled/aired debates are excluded from "upcoming". Scoped by
// channel_id so one channel never borrows another's debates (item 3).
function channelUpcoming(channelId, debates, now) {
  const list = (debates || [])
    .filter((d) => String(d.channel_id) === String(channelId) && d.status !== "cancelled" && d.status !== "aired")
    .map((d) => ({ d, start: debateStart(d) }))
    .filter((x) => x.start && x.start.getTime() >= now - 3 * 3600000) // keep live (up to 3h old)
    .sort((a, b) => a.start - b.start);
  return { nearest: list[0]?.d || null, start: list[0]?.start || null, more: Math.max(0, list.length - 1) };
}
// Proximity → gradual green. Returns an inline style whose green intensity grows
// as the debate approaches (over a 7-day window), plus a status label. Nothing is
// hardcoded per channel — it's all derived from the actual remaining time.
function proximityVisual(start, now, status) {
  if (!start) return { style: {}, label: null, tone: "none" };
  const ms = start.getTime() - now;
  if (status === "live" || (ms <= 0 && ms > -3 * 3600000)) {
    return { style: { borderColor: "rgba(239,68,68,0.7)", backgroundColor: "rgba(239,68,68,0.06)" }, label: "Live now", tone: "live" };
  }
  const hours = ms / 3600000;
  const WINDOW = 168; // 7 days → full ramp
  const proximity = Math.max(0, Math.min(1, 1 - hours / WINDOW));
  const style = {
    borderColor: `rgba(16,185,129,${(0.18 + 0.72 * proximity).toFixed(3)})`,
    backgroundColor: `rgba(16,185,129,${(0.03 + 0.13 * proximity).toFixed(3)})`,
  };
  let label;
  if (hours <= 6) label = "Starting soon";
  else if (hours <= 24) label = "Within a day";
  else if (hours <= 72) label = "In a few days";
  else label = "Upcoming";
  return { style, label, proximity, tone: "upcoming" };
}
function fmtDebateWhen(start) {
  if (!start) return "—";
  return `${start.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} @ ${start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

// ONE reusable channel card = the entry point for Schedule Debate + Debate List
// (item 1), and it surfaces THIS channel's nearest upcoming debate (item 2) with
// a real-time proximity colour (item 4). Clicking the card opens the two options.
// Channel card — clicking the card / Channel Name opens the dedicated channel
// page (by channel ID). It shows basic info (name, Lok Sabha, tone) and this
// channel's nearest upcoming debate with a real-time proximity colour. Schedule
// Debate / Debate List now live on the detail page (not an inline menu here).
function ChannelCard({ ch, debates, now, tone, onOpen }) {
  const { nearest, start, more } = channelUpcoming(ch.id, debates, now);
  const vis = proximityVisual(start, now, nearest?.status);
  const speakers = (nearest?.spokespersons || []).map((s) => s.name).filter(Boolean);
  return (
    <button
      type="button"
      onClick={() => onOpen(ch)}
      style={vis.style}
      className={`w-full text-left bg-white rounded-2xl border shadow-sm p-4 transition-colors hover:shadow-md ${vis.tone === "none" ? "border-gray-100" : ""}`}
      title={`Open ${ch.name}`}
    >
      <div className="flex items-center justify-between gap-2">
        <Tv className={vis.tone === "live" ? "text-red-600" : "text-[#164FA3]"} size={20} />
        {vis.label && <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${vis.tone === "live" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>{vis.label}</span>}
      </div>
      <div className="font-bold text-gray-900 text-sm mt-2 truncate hover:text-[#164FA3]" title={ch.name}>{ch.name}</div>
      {ch.lok_sabha_name && <div className="text-[11px] font-medium text-gray-400 truncate" title={ch.lok_sabha_name}>{ch.lok_sabha_name}</div>}
      <span className={`mt-1 inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${tone[ch.tone] || tone.unknown}`}>{ch.tone}</span>

      {nearest ? (
        <div className="mt-3 pt-3 border-t border-gray-200/70 space-y-0.5">
          <div className="text-xs font-semibold text-gray-900 truncate" title={nearest.topic}>{nearest.topic || "Debate"}</div>
          <div className="text-[11px] text-gray-600">{fmtDebateWhen(start)}</div>
          <div className="text-[11px] text-gray-500 truncate">{speakers.length ? speakers.join(", ") : "No spokesperson yet"}</div>
          <div className="flex items-center gap-1.5 pt-0.5">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${nearest.status === "live" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{nearest.status}</span>
            {more > 0 && <span className="text-[10px] text-gray-400">+{more} more</span>}
          </div>
        </div>
      ) : (
        <div className="mt-3 pt-3 border-t border-gray-100 text-[11px] text-gray-400">No upcoming debate.</div>
      )}
    </button>
  );
}

// Add Channel — exactly two fields: Channel Name + Lok Sabha. Lok Sabha options
// come live from the existing Lok Sabha Master (GET /api/locations?type=lok_sabha),
// the single source of truth — nothing hardcoded.
function ChannelModal({ onClose, onSaved }) {
  const [name, setName] = useState("");
  const [lokSabha, setLokSabha] = useState("");
  const [options, setOptions] = useState([]);
  const [loadingLs, setLoadingLs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/locations?type=lok_sabha")
      .then((r) => (r.ok ? r.json() : { locations: [] }))
      .then((d) => { if (alive) setOptions(d.locations || []); })
      .catch(() => { if (alive) setError("Couldn't load the Lok Sabha list. Please try again."); })
      .finally(() => { if (alive) setLoadingLs(false); });
    return () => { alive = false; };
  }, []);

  async function save() {
    if (saving) return;
    const clean = name.trim();
    if (!clean) { setError("Channel name is required."); return; }
    if (!lokSabha) { setError("Please select a Lok Sabha."); return; }
    setSaving(true); setError("");
    try {
      const r = await fetch("/api/media/channels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: clean, lok_sabha_id: Number(lokSabha) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.message || "Could not add the channel."); setSaving(false); return; }
      onSaved("Channel added successfully.");
    } catch {
      setError("Could not add the channel. Please try again.");
      setSaving(false);
    }
  }

  return (
    <Modal title="Add Channel" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Channel Name <span className="text-red-500">*</span></label>
          <input autoFocus className={inp} value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="e.g. IBC24" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Lok Sabha <span className="text-red-500">*</span></label>
          <select className={inp} value={lokSabha} onChange={(e) => { setLokSabha(e.target.value); setError(""); }} disabled={loadingLs}>
            <option value="">{loadingLs ? "Loading…" : "— select Lok Sabha —"}</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">Sourced live from the Lok Sabha Master.</p>
        </div>
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold inline-flex items-center gap-2">{saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : "Add Channel"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================ CHANNELS
function ChannelsTab({ data, onChange, flash }) {
  const router = useRouter();
  const [showAddChannel, setShowAddChannel] = useState(false);
  const now = useNow(60000);
  const TONE = { supportive: "bg-emerald-100 text-emerald-700", neutral: "bg-gray-100 text-gray-600", opposing: "bg-red-100 text-red-700", unknown: "bg-amber-100 text-amber-700" };

  // Clicking a channel opens its dedicated page (by channel ID). Schedule Debate
  // and the Debate List live there — not inline on this main page.
  const openChannel = (ch) => router.push(`/dashboard/media/channels/${ch.id}`);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-gray-900">News Channels</h3>
          <p className="text-sm text-gray-500">Click a channel to open its page — schedule debates and see its debate list there.</p>
        </div>
        <button onClick={() => setShowAddChannel(true)} className="inline-flex items-center gap-1.5 bg-[#164FA3] hover:bg-blue-800 text-white px-3.5 py-2 rounded-lg text-sm font-semibold">
          <Plus size={15} /> Add Channel
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {data.channels.map((c) => (
          <ChannelCard key={c.id} ch={c} debates={data.upcomingDebates} now={now} tone={TONE} onOpen={openChannel} />
        ))}
      </div>

      {showAddChannel && <ChannelModal onClose={() => setShowAddChannel(false)} onSaved={(msg) => { setShowAddChannel(false); onChange(); flash?.(msg); }} />}
    </div>
  );
}

// ============================================================ CONFERENCES
function ConferencesTab({ data, onChange, filtered }) {
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
          <div className="col-span-full bg-white rounded-2xl p-8 text-center text-gray-400 text-sm border border-gray-100">{filtered ? "No press conferences found for the selected date range." : "No press conferences."}</div>
        ) : data.conferences.map((c) => (
          <div key={c.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">{new Date(c.conference_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", weekday: "short" })}</div>
                <h4 className="font-bold text-gray-900 mt-1">{c.title}</h4>
                {c.venue && <div className="text-xs text-gray-500 mt-1">{c.venue}</div>}
                {c.spokesperson_name && (
                  <div className="mt-2 inline-flex items-center gap-1.5"><Avatar name={c.spokesperson_name} src={c.spokesperson_photo} size={22} /><span className="text-xs font-medium text-gray-700">{c.spokesperson_name}</span></div>
                )}
                {c.file_url && (
                  <a href={c.file_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-[#164FA3] hover:underline">
                    <FileText size={13} /> Open document
                  </a>
                )}
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

      {showAdd && <ConferenceModal spokespersons={data.spokespersons} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); onChange(); }} />}
      {editing && <ConferenceModal editing={editing} spokespersons={data.spokespersons} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); }} />}
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
    languages: editing.languages || "",
  } : { name: "", mobile: "", languages: "" });
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
      <input className={inp} placeholder="Languages (e.g. Hindi, English)" value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} />
      <ModalActions onClose={onClose} onSave={save} saving={saving} disabled={!form.name} />
    </Modal>
  );
}

// ============================================================ ANALYTICS
function AnalyticsTab({ data, filtered }) {
  const a = data.analytics;
  const ds = a.debateStats || { total: 0, done: 0, positive: 0, neutral: 0, negative: 0 };
  return (
    <div className="space-y-6">
      {/* Debate status cards — counts straight from the debates records
          (respecting the date filter). Informational: no navigation. */}
      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-2">Debates</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SumCard label="Total Debates Scheduled" value={ds.total} accent />
          <SumCard label="Total Debates Done" value={ds.done} />
          <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
            <div className="text-2xl font-bold text-emerald-600 tabular-nums">{ds.positive}</div>
            <div className="text-xs font-medium mt-1 text-gray-500">Positive Debates</div>
          </div>
          <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
            <div className="flex items-start gap-5">
              <div>
                <div className="text-2xl font-bold text-gray-600 tabular-nums">{ds.neutral}</div>
                <div className="text-xs font-medium mt-1 text-gray-500">Neutral</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600 tabular-nums">{ds.negative}</div>
                <div className="text-xs font-medium mt-1 text-gray-500">Negative</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-2">Coverage</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SumCard label={filtered ? "Coverage (selected range)" : "Coverage (30d)"} value={a.counts?.coverage_total || 0} accent />
          <SumCard label="Positive" value={a.counts?.positive || 0} />
          <SumCard label="Neutral" value={a.counts?.neutral || 0} />
          <SumCard label="Negative" value={a.counts?.negative || 0} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChannelToneCard channels={a.channelTone || []} />
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

// Channel Tone — every channel from the master, grouped by its stored tone:
// Positive (supportive) first, Negative (opposing) below, then Neutral/Unrated
// (neutral or unknown) so a channel without a clear stance is never shown as a
// false Positive/Negative. Each row carries a small colored tone badge and the
// number of debates it actually hosted in the selected date range (real data
// backing the label). Nothing hardcoded — names/tone/counts come from the DB.
const TONE_META = {
  positive: { label: "Positive", badge: "bg-emerald-100 text-emerald-700" },
  negative: { label: "Negative", badge: "bg-red-100 text-red-700" },
  neutral: { label: "Neutral", badge: "bg-gray-100 text-gray-600" },
  unrated: { label: "Unrated", badge: "bg-amber-100 text-amber-700" },
};
// Map the stored master tone → display group. 'supportive'→positive,
// 'opposing'→negative, 'neutral'→neutral, anything else/unknown→unrated.
function toneGroup(tone) {
  if (tone === "supportive") return "positive";
  if (tone === "opposing") return "negative";
  if (tone === "neutral") return "neutral";
  return "unrated";
}

function ChannelToneRow({ c }) {
  const meta = TONE_META[toneGroup(c.tone)];
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-sm text-gray-800 truncate">{c.name}</span>
      <span className="flex items-center gap-2 shrink-0">
        {Number(c.debates) > 0 && <span className="text-[11px] text-gray-400 tabular-nums">{Number(c.debates)} debate{Number(c.debates) === 1 ? "" : "s"}</span>}
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
      </span>
    </div>
  );
}

function ChannelToneCard({ channels }) {
  const groups = { positive: [], negative: [], neutral: [], unrated: [] };
  for (const c of channels) groups[toneGroup(c.tone)].push(c);
  const Section = ({ title, items }) => (
    items.length === 0 ? null : (
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">{title}</div>
        <div className="divide-y divide-gray-50">
          {items.map((c) => <ChannelToneRow key={c.id} c={c} />)}
        </div>
      </div>
    )
  );
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><Tv size={16} className="text-[#164FA3]" /> Channel Tone</h3>
      {channels.length === 0 ? (
        <div className="text-sm text-gray-400">No news channels available.</div>
      ) : (
        <div className="space-y-4">
          <Section title="Positive Channels" items={groups.positive} />
          <Section title="Negative Channels" items={groups.negative} />
          <Section title="Neutral / Unrated" items={[...groups.neutral, ...groups.unrated]} />
        </div>
      )}
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

export function PressNoteModal({ newspapers, onClose, onSaved, editing, defaultNewspaperId }) {
  const [form, setForm] = useState(editing ? {
    title: editing.title || "", summary: editing.summary || "", kind: editing.kind || "press_note",
    newspaper_id: editing.newspaper_id ? String(editing.newspaper_id) : "",
    newspaper_name: "",
    coverage_date: editing.coverage_date ? String(editing.coverage_date).slice(0, 10) : "",
    sentiment: editing.sentiment || "", file_url: editing.file_url || "",
  } : { title: "", summary: "", kind: "press_note", newspaper_id: defaultNewspaperId ? String(defaultNewspaperId) : "", newspaper_name: "", coverage_date: new Date().toISOString().slice(0, 10), sentiment: "", file_url: "" });
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
  const anchorRef = useRef(null);
  const [width, setWidth] = useState(320);
  // Compare loosely so ids that arrive as numbers or strings both resolve, and
  // never store a duplicate (toggle only ever adds an id not already present).
  const isOn = (id) => value.some((v) => String(v) === String(id));
  const selected = options.filter((o) => isOn(o.id));
  const filtered = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id) => onChange(isOn(id) ? value.filter((x) => String(x) !== String(id)) : [...value, id]);
  const openMenu = () => {
    if (anchorRef.current) setWidth(anchorRef.current.getBoundingClientRect().width);
    setOpen((v) => !v);
  };
  return (
    <div>
      {/* Trigger. The menu itself is portaled (FloatingPopover) so the modal's
          overflow-auto can't clip it and a long list scrolls freely / flips up
          when there's no room below. */}
      <button ref={anchorRef} type="button" onClick={openMenu} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between hover:bg-gray-50">
        <span className={selected.length ? "text-gray-800" : "text-gray-400"}>{selected.length ? `${selected.length} spokesperson${selected.length === 1 ? "" : "s"} selected` : "Select spokesperson(s)"}</span>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <FloatingPopover anchorRef={anchorRef} open={open} onClose={() => { setOpen(false); setQ(""); }} align="left" width={width} estimatedHeight={300}>
        <div className="p-2 border-b border-gray-100">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search spokesperson…" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
        </div>
        <div className="max-h-56 overflow-auto">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">No spokespersons exist yet. Add them on the Spokespersons tab.</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">No match for “{q}”.</div>
          ) : filtered.map((o) => {
            const on = isOn(o.id);
            return (
              <button key={o.id} type="button" onClick={() => toggle(o.id)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50">
                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? "bg-[#164FA3] border-[#164FA3]" : "border-gray-300"}`}>{on && <Check size={12} className="text-white" />}</span>
                <span className="truncate">{o.name}</span>
              </button>
            );
          })}
        </div>
      </FloatingPopover>
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

// Searchable single-select spokesperson dropdown with photos. Options come from
// the live Spokesperson master (never hardcoded); it stores the spokesperson's
// ID (the relationship) and shows [photo] name in the trigger, each option, and
// the selected chip. Avatar renders the saved photo or a clean initials/avatar
// fallback — never a broken image. Portaled + scrollable so a long list works.
function SpokespersonSelect({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const anchorRef = useRef(null);
  const [width, setWidth] = useState(320);
  const selected = options.find((o) => String(o.id) === String(value)) || null;
  const filtered = options.filter((o) => (o.name || "").toLowerCase().includes(q.trim().toLowerCase()));
  const openMenu = () => { if (anchorRef.current) setWidth(anchorRef.current.getBoundingClientRect().width); setOpen((v) => !v); };
  return (
    <div>
      <button ref={anchorRef} type="button" onClick={openMenu} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between gap-2 hover:bg-gray-50">
        {selected ? (
          <span className="flex items-center gap-2 min-w-0"><Avatar name={selected.name} src={selected.photo_url} size={24} /><span className="truncate text-gray-800">{selected.name}</span></span>
        ) : <span className="text-gray-400">Select spokesperson</span>}
        <ChevronDown size={16} className={`text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <FloatingPopover anchorRef={anchorRef} open={open} onClose={() => { setOpen(false); setQ(""); }} align="left" width={width} estimatedHeight={320}>
        <div className="p-2 border-b border-gray-100">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search spokesperson…" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
        </div>
        <div className="max-h-60 overflow-auto">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">No spokespersons exist yet. Add them on the Spokespersons tab.</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">No match for “{q}”.</div>
          ) : filtered.map((o) => (
            <button key={o.id} type="button" onClick={() => { onChange(String(o.id)); setOpen(false); setQ(""); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-gray-50">
              <Avatar name={o.name} src={o.photo_url} size={30} />
              <span className="truncate flex-1">{o.name}</span>
              {String(o.id) === String(value) && <Check size={14} className="text-[#164FA3] shrink-0" />}
            </button>
          ))}
        </div>
      </FloatingPopover>
      {selected && (
        <div className="flex items-center gap-2 mt-2">
          <Avatar name={selected.name} src={selected.photo_url} size={32} />
          <span className="text-sm font-medium text-gray-800 truncate">{selected.name}</span>
          <button type="button" onClick={() => onChange("")} className="ml-1 text-gray-400 hover:text-red-600" title="Clear"><X size={13} /></button>
        </div>
      )}
    </div>
  );
}

export function DebateModal({ channels, spokespersons, onClose, onSaved, editing, defaultChannelId }) {
  const [form, setForm] = useState(editing ? {
    channel_id: editing.channel_id || "", topic: editing.topic || "",
    debate_date: editing.debate_date ? editing.debate_date.slice(0, 10) : "",
    debate_time: editing.debate_time ? editing.debate_time.slice(0, 5) : "20:00",
    brief_pdf_url: editing.brief_pdf_url || "",
    talking_points: editing.talking_points || "",
    status: editing.status || "scheduled",
    viral_score: editing.viral_score || 0,
    spokesperson_ids: (editing.spokespersons || []).map((s) => s.id),
  } : { channel_id: defaultChannelId ? String(defaultChannelId) : "", topic: "", debate_date: "", debate_time: "20:00", brief_pdf_url: "", talking_points: "", spokesperson_ids: [] });
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
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Channel</label>
          <ChannelSelect options={channels} value={form.channel_id} onChange={(id) => setForm({ ...form, channel_id: id })} />
        </div>
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Date *</label>
          <input type="date" className={inp} value={form.debate_date} onChange={(e) => setForm({ ...form, debate_date: e.target.value })} />
        </div>
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Time</label>
          <input type="time" className={inp} value={form.debate_time} onChange={(e) => setForm({ ...form, debate_time: e.target.value })} />
        </div>
        <div><label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Debate File (PDF, JPG, PNG, WEBP)</label><FileUpload value={form.brief_pdf_url} onChange={(url) => setForm({ ...form, brief_pdf_url: url })} endpoint="/api/media/uploads" accept=".pdf,.jpg,.jpeg,.png,.webp" /></div>
      </div>
      <textarea className={inp} rows={2} placeholder="Talking points" value={form.talking_points} onChange={(e) => setForm({ ...form, talking_points: e.target.value })} />
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

// Searchable single-select for the debate's News Channel. Options come from the
// live News Channels master (data.channels) — never hardcoded. Stores the
// channel's unique id (not its text); shows the currently-selected channel's
// name (so editing pre-fills correctly); scrolls when the list is long; and
// shows a clear empty state when no channels exist so the user isn't left with a
// blank control.
function ChannelSelect({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const anchorRef = useRef(null);
  const [width, setWidth] = useState(320);
  // Loose match so a numeric id from the DB and a string form value both resolve.
  const selected = options.find((o) => String(o.id) === String(value)) || null;
  const filtered = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  const noChannels = options.length === 0;
  const openMenu = () => {
    if (noChannels) return;
    if (anchorRef.current) setWidth(anchorRef.current.getBoundingClientRect().width);
    setOpen((v) => !v);
  };
  return (
    <div>
      <button
        ref={anchorRef}
        type="button"
        onClick={openMenu}
        className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between ${noChannels ? "bg-gray-50 cursor-not-allowed" : "hover:bg-gray-50"}`}
      >
        <span className={selected ? "text-gray-800 truncate" : "text-gray-400 truncate"}>
          {noChannels ? "No news channels available" : selected ? selected.name : "Select news channel"}
        </span>
        {!noChannels && <ChevronDown size={16} className={`text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {/* Portaled menu so the modal's overflow-auto can't clip it. */}
      <FloatingPopover anchorRef={anchorRef} open={open && !noChannels} onClose={() => { setOpen(false); setQ(""); }} align="left" width={width} estimatedHeight={280}>
        <div className="p-2 border-b border-gray-100">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channel…" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
        </div>
        <div className="max-h-56 overflow-auto">
          {/* Clear selection (channel is optional on a debate). */}
          <button type="button" onClick={() => { onChange(""); setOpen(false); setQ(""); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-gray-400 hover:bg-gray-50">
            — No channel —
          </button>
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">No match for “{q}”.</div>
          ) : filtered.map((o) => {
            const on = String(o.id) === String(value);
            return (
              <button key={o.id} type="button" onClick={() => { onChange(o.id); setOpen(false); setQ(""); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50">
                <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${on ? "bg-[#164FA3] border-[#164FA3]" : "border-gray-300"}`}>{on && <Check size={11} className="text-white" />}</span>
                <span className="truncate">{o.name}</span>
              </button>
            );
          })}
        </div>
      </FloatingPopover>
    </div>
  );
}

function ConferenceModal({ onClose, onSaved, editing, spokespersons = [] }) {
  const [form, setForm] = useState(editing ? {
    title: editing.title || "",
    conference_date: editing.conference_date ? new Date(editing.conference_date).toISOString().slice(0, 16) : "",
    venue: editing.venue || "",
    agenda: editing.agenda || "",
    status: editing.status || "scheduled",
    spokesperson_id: editing.spokesperson_id ? String(editing.spokesperson_id) : "",
  } : { title: "", conference_date: "", venue: "AAP State Office, Raipur", agenda: "", spokesperson_id: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Active spokespersons for selection. When editing, include the saved
  // spokesperson even if it's now inactive, so its name + photo still load.
  const spokesOptions = (() => {
    const active = (spokespersons || []).filter((s) => s.is_active == null || Number(s.is_active) === 1);
    if (editing?.spokesperson_id && !active.some((s) => String(s.id) === String(editing.spokesperson_id))) {
      return [{ id: editing.spokesperson_id, name: editing.spokesperson_name || "Spokesperson", photo_url: editing.spokesperson_photo || null, is_active: 0 }, ...active];
    }
    return active;
  })();
  async function save() {
    setError("");
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.conference_date) { setError("Date & time are required."); return; }
    setSaving(true);
    try {
      const url = editing ? `/api/media/conferences/${editing.id}` : "/api/media/conferences";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || "Unable to save the press conference. Please try again.");
      onSaved();
    } catch (e) {
      setError(e.message || "Unable to save the press conference. Please try again.");
      setSaving(false); // keep the modal open, preserve entered data
    }
  }
  return (
    <Modal title={editing ? "Edit Press Conference" : "Schedule Press Conference"} onClose={onClose}>
      <input className={inp} placeholder="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <input type="datetime-local" className={inp} value={form.conference_date} onChange={(e) => setForm({ ...form, conference_date: e.target.value })} />
      <input className={inp} placeholder="Venue" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
      {/* UI label is "Press Points"; the stored field remains `agenda` so existing
          data and the backend/API are unaffected. */}
      <textarea className={inp} rows={3} placeholder="Press Points" value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} />
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Spokesperson</label>
        <SpokespersonSelect options={spokesOptions} value={form.spokesperson_id} onChange={(id) => setForm({ ...form, spokesperson_id: id })} />
      </div>
      {editing && (
        <select className={inp} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      )}
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
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
