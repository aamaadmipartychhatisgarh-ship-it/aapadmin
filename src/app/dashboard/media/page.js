"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { canAccessMedia } from "@/lib/permissions";
import {
  LayoutDashboard, Newspaper, Tv, Mic, UserCheck, BarChart3, Upload, Plus, Loader2, X,
  Calendar, FileText, MessageCircle, CheckCircle2, TrendingUp, Eye, Pencil, ChevronDown, Check, Search, Video, Trash2,
} from "lucide-react";
import MediaDashboardTab from "@/components/media/MediaDashboardTab";
import FloatingPopover from "@/components/FloatingPopover";
import Avatar from "@/components/Avatar";
import CommonPrintButton from "@/components/common/CommonPrintButton";
import CommonPDFExportButton from "@/components/common/CommonPDFExportButton";
import { captureCharts } from "@/lib/print/captureNode";
import { useRouter } from "next/navigation";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, Legend, Cell,
} from "recharts";

export default function Page() {
  return <SupervisorGuard allow={canAccessMedia}><Body /></SupervisorGuard>;
}

const TABS = [
  { k: "dashboard", l: "Dashboard", icon: LayoutDashboard },
  { k: "newspapers", l: "Newspapers", icon: Newspaper },
  { k: "channels", l: "News Channels", icon: Tv },
  { k: "conferences", l: "Press Conferences", icon: Mic },
  { k: "spokespersons", l: "Spokespersons", icon: UserCheck },
  // Analytics is no longer a separate tab — it's merged into the Dashboard tab
  // (BUG #12 Part B) so there is ONE Media Dashboard page with dashboard + analytics.
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
  const showFilter = ["dashboard", "newspapers", "channels", "conferences"].includes(tab);

  // Build the PDF payload for whichever tab is currently shown, from the same
  // live `data` the tab renders — so the export always matches the screen. The
  // Dashboard also snapshots its charts so they render in the PDF, never blank.
  const TAB_LABEL = { dashboard: "Media Dashboard", newspapers: "Newspapers", channels: "News Channels", conferences: "Press Conferences", spokespersons: "Spokespersons" };
  const TAB_FILE = { dashboard: "media-dashboard.pdf", newspapers: "newspapers.pdf", channels: "news-channels.pdf", conferences: "press-conferences.pdf", spokespersons: "spokespersons.pdf" };
  async function buildMediaPayload() {
    const stamp = new Date().toLocaleString("en-GB");
    if (tab === "newspapers") {
      const rows = (data.newspaperStats || []).map((np) => [np.name || "—", np.lok_sabha_all ? "All Lok Sabha" : (np.lok_sabha_name || "—"), String(Number(np.total) || 0)]);
      return { title: "Newspapers", subtitle: `${rows.length} newspaper${rows.length === 1 ? "" : "s"} · ${stamp}`, orientation: "portrait",
        table: { columns: [{ header: "Newspaper", flex: 2.4 }, { header: "Lok Sabha", flex: 2 }, { header: "Total Published", flex: 1, align: "right" }], rows } };
    }
    if (tab === "channels") {
      const rows = (data.channels || []).map((ch) => [ch.name || "—", ch.lok_sabha_name || "—", ch.tone || "—", String(Number(ch.total_debates) || 0)]);
      return { title: "News Channels", subtitle: `${rows.length} channel${rows.length === 1 ? "" : "s"} · ${stamp}`, orientation: "portrait",
        table: { columns: [{ header: "Channel", flex: 2.2 }, { header: "Lok Sabha", flex: 2 }, { header: "Tone", flex: 1 }, { header: "Total Debates", flex: 1, align: "right" }], rows } };
    }
    if (tab === "conferences") {
      const rows = (data.conferences || []).map((c) => {
        const spk = (c.spokespersons?.length ? c.spokespersons.map((s) => s.name) : (c.spokesperson_name ? [c.spokesperson_name] : [])).filter(Boolean).join(", ");
        return [fmtNewsDate(c.conference_date), c.title || "—", c.venue || "—", spk || "—", c.status || "—"];
      });
      return { title: "Press Conferences", subtitle: `${rows.length} conference${rows.length === 1 ? "" : "s"} · ${stamp}`, orientation: "landscape",
        table: { columns: [{ header: "Date", flex: 1 }, { header: "Title", flex: 2.4 }, { header: "Venue", flex: 1.8 }, { header: "Spokesperson(s)", flex: 2 }, { header: "Status", flex: 0.9 }], rows } };
    }
    if (tab === "spokespersons") {
      const rows = (data.spokespersons || []).map((s) => [s.name || "—", s.expertise || "—", s.languages || "—", s.mobile || "—"]);
      return { title: "Spokespersons", subtitle: `${rows.length} spokesperson${rows.length === 1 ? "" : "s"} · ${stamp}`, orientation: "portrait",
        table: { columns: [{ header: "Name", flex: 2 }, { header: "Expertise", flex: 2 }, { header: "Languages", flex: 1.6 }, { header: "Mobile", flex: 1.4 }], rows } };
    }
    // dashboard (+ analytics): snapshot the charts and include the newspaper mix table.
    const images = await captureCharts("#media-dashboard-capture");
    return { title: "Media Dashboard", subtitle: `${stamp}`, orientation: "portrait", images };
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {toast && <div className="fixed top-4 right-4 z-[80] flex items-center gap-2 bg-emerald-600 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg"><CheckCircle2 size={16} /> {toast}</div>}
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Media Center</h1>
          <p className="text-gray-500 mt-2 font-medium">Newspaper coverage, debates, press conferences and spokespersons in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <CommonPrintButton title={TAB_LABEL[tab] || "Media Center"} />
          <CommonPDFExportButton filename={TAB_FILE[tab] || "media.pdf"} getPayload={buildMediaPayload} />
        </div>
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

      {/* ONE Media Dashboard page: the dashboard summary AND the full analytics
          (News Channel / Newspaper / Press Conference), merged (BUG #12 Part B).
          Both read the same /api/media data source — no duplicate analytics page. */}
      {tab === "dashboard" && (
        <div id="media-dashboard-capture" className="space-y-8">
          <MediaDashboardTab onOpenTab={setTab} />
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2"><BarChart3 size={18} className="text-[#164FA3]" /> Media Analytics</h2>
            <AnalyticsTab data={data} filtered={filterActive} />
          </div>
        </div>
      )}
      {tab === "newspapers" && <NewspapersTab data={data} onChange={load} flash={setToast} filtered={filterActive} />}
      {tab === "channels" && <ChannelsTab data={data} onChange={load} flash={setToast} filtered={filterActive} />}
      {tab === "conferences" && <ConferencesTab data={data} onChange={load} filtered={filterActive} />}
      {tab === "spokespersons" && <SpokespersonsTab data={data} onChange={load} />}
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
  const [editNewspaper, setEditNewspaper] = useState(null); // newspaper being edited (BUG 21)
  const [uploadFor, setUploadFor] = useState(null); // newspaper id to pre-select on Upload

  // BUG 21 — delete a newspaper. Confirm first; the backend blocks deletion when
  // the newspaper still has publications (so published records are never lost).
  async function deleteNewspaper(np) {
    if (!confirm(`Delete the newspaper “${np.name}”?\n\nThis removes only the newspaper. Its published records are never deleted — if any exist, deletion is blocked until they're removed or reassigned.`)) return;
    try {
      const r = await fetch(`/api/media/newspapers/${np.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash?.(d.message || "Could not delete the newspaper."); return; }
      flash?.("Newspaper deleted.");
      onChange();
    } catch { flash?.("Could not delete the newspaper. Please try again."); }
  }
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
  // BUG 22 — the green indicator scales each newspaper's OWN published count
  // against the busiest newspaper (a single consistent scale across all cards),
  // computed live from the DB counts. Uses ALL newspapers (not the filtered
  // view) so a card's shade is stable regardless of the Lok Sabha filter.
  const maxTotal = allCards.reduce((m, c) => Math.max(m, Number(c.total) || 0), 0);
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
            <NewspaperCard key={np.id} np={np} maxTotal={maxTotal} onUpload={uploadForNewspaper} onViewList={viewListFor} onEdit={setEditNewspaper} onDelete={deleteNewspaper} />
          ))}
        </div>
      )}

      {showAdd && <PressNoteModal newspapers={data.newspapers} defaultNewspaperId={uploadFor} onClose={() => { setShowAdd(false); setUploadFor(null); }} onSaved={(msg) => { setShowAdd(false); setUploadFor(null); onChange(); flash?.(msg); }} />}
      {showAddNewspaper && <NewspaperModal onClose={() => setShowAddNewspaper(false)} onSaved={(msg) => { setShowAddNewspaper(false); onChange(); flash?.(msg); }} />}
      {editNewspaper && <NewspaperModal editing={editNewspaper} onClose={() => setEditNewspaper(null)} onSaved={(msg) => { setEditNewspaper(null); onChange(); flash?.(msg); }} />}
    </div>
  );
}

// Add Newspaper — name + Lok Sabha mapping. The Lok Sabha options are fetched
// live from the existing Lok Sabha Master (GET /api/locations?type=lok_sabha) —
// the single source of truth — so updates to that master flow through here
// automatically; nothing is hardcoded. An "All" option maps the newspaper to
// every constituency (stored as a flag, not a fake Lok Sabha row).
function NewspaperModal({ onClose, onSaved, editing }) {
  const isEdit = !!editing;
  const [name, setName] = useState(editing?.name || "");
  // Prefill the Lok Sabha mapping from the newspaper being edited.
  const [lokSabha, setLokSabha] = useState(
    editing ? (editing.lok_sabha_all ? "all" : (editing.lok_sabha_id ? String(editing.lok_sabha_id) : "")) : ""
  ); // "" | "all" | "<id>"
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
      const url = isEdit ? `/api/media/newspapers/${editing.id}` : "/api/media/newspapers";
      const method = isEdit ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.message || (isEdit ? "Could not update the newspaper." : "Could not add the newspaper.")); setSaving(false); return; }
      onSaved(isEdit ? "Newspaper updated successfully." : "Newspaper added successfully.");
    } catch {
      setError(isEdit ? "Could not update the newspaper. Please try again." : "Could not add the newspaper. Please try again.");
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Newspaper" : "Add Newspaper"} onClose={onClose}>
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
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold inline-flex items-center gap-2">{saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : (isEdit ? "Save Changes" : "Add Newspaper")}</button>
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
// Green publication indicator (BUG 22): width + shade scale with this
// newspaper's OWN published count relative to the busiest newspaper. Derived,
// never a hardcoded green. ratio in [0,1] → light green (low) to strong green
// (high); an empty ratio stays at the light end (used only when count > 0).
function greenForRatio(ratio) {
  const r = Math.max(0, Math.min(1, ratio || 0));
  const lightness = 78 - r * 46; // 78% (light) → 32% (strong)
  const saturation = 45 + r * 32; // 45% → 77%
  return `hsl(146, ${saturation}%, ${lightness}%)`;
}

function NewspaperCard({ np, maxTotal, onUpload, onViewList, onEdit, onDelete }) {
  const lokSabha = np.lok_sabha_all ? "All Lok Sabha" : (np.lok_sabha_name || "—");
  const count = Number(np.total) || 0;
  const max = Number(maxTotal) || 0;
  const ratio = max > 0 ? count / max : 0; // this newspaper vs the busiest one
  const pct = Math.round(ratio * 100);
  const indicatorTitle = count === 0
    ? "No publications yet"
    : `${count} publication${count === 1 ? "" : "s"}${max > 0 ? ` · ${pct}% of the most-published newspaper` : ""}`;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center shrink-0"><Newspaper size={15} /></div>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-gray-900 text-sm truncate" title={np.name}>{np.name}</div>
          <div className="text-[11px] font-medium text-gray-400 truncate" title={lokSabha}>{lokSabha}</div>
        </div>
        {/* Edit / Delete for every newspaper (BUG 21) */}
        {onEdit && <button onClick={() => onEdit(np)} title="Edit newspaper" className="p-1.5 text-gray-400 hover:text-[#164FA3] hover:bg-blue-50 rounded-lg shrink-0"><Pencil size={14} /></button>}
        {onDelete && <button onClick={() => onDelete(np)} title="Delete newspaper" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 size={14} /></button>}
      </div>
      <div className="rounded-xl bg-gray-50 px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{count}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Total Published</div>
        </div>
        {/* Dynamic green indicator — proportional to this newspaper's own count
            (§1/§2/§7). Width scales with the ratio; the shade deepens with it. */}
        <div className="mt-2 h-2 rounded-full bg-gray-200 overflow-hidden" title={indicatorTitle}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: count > 0 ? `${Math.max(pct, 6)}%` : "0%", background: greenForRatio(ratio) }}
          />
        </div>
        <div className="mt-1 text-[10px] text-gray-400" title={indicatorTitle}>
          {count === 0 ? "No publications yet" : (max > 0 ? `${pct}% of the busiest newspaper` : `${count} published`)}
        </div>
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
function ChannelCard({ ch, debates, now, tone, onOpen, onSchedule, onEdit, onDelete }) {
  const { nearest, start, more } = channelUpcoming(ch.id, debates, now);
  const vis = proximityVisual(start, now, nearest?.status);
  const speakers = (nearest?.spokespersons || []).map((s) => s.name).filter(Boolean);
  return (
    <div
      style={vis.style}
      className={`bg-white rounded-2xl border shadow-sm p-4 flex flex-col transition-shadow hover:shadow-md ${vis.tone === "none" ? "border-gray-100" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <Tv className={vis.tone === "live" ? "text-red-600" : "text-[#164FA3]"} size={20} />
        <div className="flex items-center gap-1">
          {vis.label && <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${vis.tone === "live" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>{vis.label}</span>}
          {/* Edit / Delete for every channel (BUG 24) */}
          {onEdit && <button type="button" onClick={() => onEdit(ch)} title="Edit channel" className="p-1 text-gray-400 hover:text-[#164FA3] hover:bg-blue-50 rounded"><Pencil size={13} /></button>}
          {onDelete && <button type="button" onClick={() => onDelete(ch)} title="Delete channel" className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={13} /></button>}
        </div>
      </div>
      {/* Channel name opens the channel's Debate List page. */}
      <button type="button" onClick={() => onOpen(ch)} className="font-bold text-gray-900 text-sm mt-2 truncate text-left hover:text-[#164FA3] hover:underline" title={`Open ${ch.name}`}>{ch.name}</button>
      <div className="text-[11px] font-medium text-gray-500 truncate">Lok Sabha: <span className="text-gray-700">{ch.lok_sabha_name || "—"}</span></div>
      <span className={`mt-1 inline-block w-fit text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${tone[ch.tone] || tone.unknown}`}>{ch.tone}</span>
      {/* Total Debate — the real count of every debate on this channel (from DB). */}
      <div className="mt-2 text-xs font-semibold text-gray-700">Total Debate: <span className="text-[#164FA3]">{Number(ch.total_debates) || 0}</span></div>

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

      {/* Actions — Schedule Debate opens the existing Debate modal for THIS
          channel; Debate List opens the channel's dedicated list page. */}
      <div className="mt-3 pt-3 border-t border-gray-100 flex gap-2">
        <button type="button" onClick={() => onSchedule(ch)} className="flex-1 inline-flex items-center justify-center gap-1 bg-[#164FA3] hover:bg-blue-800 text-white text-xs font-semibold px-2 py-1.5 rounded-lg"><Plus size={13} /> Schedule Debate</button>
        <button type="button" onClick={() => onOpen(ch)} className="flex-1 inline-flex items-center justify-center gap-1 border border-gray-200 text-gray-700 hover:bg-gray-50 text-xs font-semibold px-2 py-1.5 rounded-lg">Debate List</button>
      </div>
    </div>
  );
}

// Add Channel — exactly two fields: Channel Name + Lok Sabha. Lok Sabha options
// come live from the existing Lok Sabha Master (GET /api/locations?type=lok_sabha),
// the single source of truth — nothing hardcoded.
function ChannelModal({ onClose, onSaved, editing }) {
  const isEdit = !!editing;
  const [name, setName] = useState(editing?.name || "");
  const [lokSabha, setLokSabha] = useState(editing?.lok_sabha_id ? String(editing.lok_sabha_id) : "");
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
      const url = isEdit ? `/api/media/channels/${editing.id}` : "/api/media/channels";
      const method = isEdit ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: clean, lok_sabha_id: Number(lokSabha) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.message || (isEdit ? "Could not update the channel." : "Could not add the channel.")); setSaving(false); return; }
      onSaved(isEdit ? "Channel updated successfully." : "Channel added successfully.");
    } catch {
      setError(isEdit ? "Could not update the channel. Please try again." : "Could not add the channel. Please try again.");
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Channel" : "Add Channel"} onClose={onClose}>
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
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold inline-flex items-center gap-2">{saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : (isEdit ? "Save Changes" : "Add Channel")}</button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================ CHANNELS
function ChannelsTab({ data, onChange, flash }) {
  const router = useRouter();
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [editChannel, setEditChannel] = useState(null); // channel being edited (BUG 24)
  const [scheduleFor, setScheduleFor] = useState(null); // channel to schedule a debate for

  // BUG 24 — delete a channel after confirmation. The backend blocks deletion
  // while debates are still linked, so debate data is never lost or orphaned.
  async function deleteChannel(ch) {
    if (!confirm(`Delete the channel “${ch.name}”?\n\nThis removes only the channel. Its debates are never deleted — if any are linked, deletion is blocked until they're removed or reassigned.`)) return;
    try {
      const r = await fetch(`/api/media/channels/${ch.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { flash?.(d.message || "Could not delete the channel."); return; }
      flash?.("Channel deleted.");
      onChange();
    } catch { flash?.("Could not delete the channel. Please try again."); }
  }
  const now = useNow(60000);
  const TONE = { supportive: "bg-emerald-100 text-emerald-700", neutral: "bg-gray-100 text-gray-600", opposing: "bg-red-100 text-red-700", unknown: "bg-amber-100 text-amber-700" };

  // Debate List → the channel's dedicated page (by ID). Schedule Debate → the
  // existing shared DebateModal, pre-set to this channel (no duplicate form).
  const openChannel = (ch) => router.push(`/dashboard/media/channels/${ch.id}`);
  const scheduleDebate = (ch) => setScheduleFor(ch);

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
          <ChannelCard key={c.id} ch={c} debates={data.upcomingDebates} now={now} tone={TONE} onOpen={openChannel} onSchedule={scheduleDebate} onEdit={setEditChannel} onDelete={deleteChannel} />
        ))}
      </div>

      {showAddChannel && <ChannelModal onClose={() => setShowAddChannel(false)} onSaved={(msg) => { setShowAddChannel(false); onChange(); flash?.(msg); }} />}
      {editChannel && <ChannelModal editing={editChannel} onClose={() => setEditChannel(null)} onSaved={(msg) => { setEditChannel(null); onChange(); flash?.(msg); }} />}
      {scheduleFor && (
        <DebateModal
          defaultChannelId={scheduleFor.id}
          channels={data.channels}
          spokespersons={data.spokespersons}
          onClose={() => setScheduleFor(null)}
          onSaved={() => { setScheduleFor(null); onChange(); flash?.("Debate scheduled."); }}
        />
      )}
    </div>
  );
}

// ============================================================ CONFERENCES
// A press conference is UPCOMING when its scheduled date/time is still in the
// future AND it isn't completed or cancelled — computed from the real stored
// datetime (BUG 25), never a hardcoded date.
function isConferenceUpcoming(c, nowMs) {
  if (!c || c.status === "completed" || c.status === "cancelled") return false;
  const t = new Date(c.conference_date).getTime();
  return !Number.isNaN(t) && t > nowMs;
}

function ConferencesTab({ data, onChange, filtered }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  // Re-evaluate "upcoming" over time so the highlight stops on its own once a
  // conference's scheduled time passes (§7). A refresh recomputes it too (§8).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
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
        ) : data.conferences.map((c) => {
          const upcoming = isConferenceUpcoming(c, now);
          return (
          <div key={c.id} className={`bg-white rounded-2xl border shadow-sm p-5 ${upcoming ? "pc-upcoming" : "border-gray-100"}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                  {new Date(c.conference_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", weekday: "short" })}
                  {upcoming && <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-[#164FA3] bg-[#164FA3]/10 px-1.5 py-0.5 rounded-full">Upcoming</span>}
                </div>
                <h4 className="font-bold text-gray-900 mt-1">{c.title}</h4>
                {c.venue && <div className="text-xs text-gray-500 mt-1">{c.venue}</div>}
                {/* Spokesperson(s) — supports multiple (§10.1); falls back to the
                    single legacy spokesperson when the multi list is empty. */}
                {(c.spokespersons?.length ? c.spokespersons : (c.spokesperson_name ? [{ id: "legacy", name: c.spokesperson_name, photo_url: c.spokesperson_photo }] : [])).map((s) => (
                  <div key={s.id} className="mt-2 inline-flex items-center gap-1.5 mr-2"><Avatar name={s.name} src={s.photo_url} size={22} /><span className="text-xs font-medium text-gray-700">{s.name}</span></div>
                ))}
                {c.co_spokesperson && (
                  <div className="mt-1 text-xs text-gray-500">Co-Spokesperson: <span className="font-medium text-gray-700">{c.co_spokesperson}</span></div>
                )}
                {c.file_url && (
                  <a href={c.file_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-[#164FA3] hover:underline">
                    <FileText size={13} /> Open document
                  </a>
                )}
              </div>
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${c.status === "completed" ? "bg-emerald-100 text-emerald-700" : c.status === "cancelled" ? "bg-gray-100 text-gray-400" : "bg-amber-100 text-amber-700"}`}>{c.status}</span>
            </div>
            {c.video_url && (
              <a href={c.video_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#164FA3] hover:underline">
                <Video size={14} /> Watch conference video
              </a>
            )}
            <div className="flex items-center justify-end mt-4 text-xs">
              <button onClick={() => setEditing(c)} title="Edit conference" className="inline-flex items-center gap-1 text-[#164FA3] font-semibold hover:underline"><Pencil size={13} /> Edit</button>
            </div>
          </div>
          );
        })}
      </div>

      {showAdd && <ConferenceModal spokespersons={data.spokespersons} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); onChange(); }} />}
      {editing && <ConferenceModal editing={editing} spokespersons={data.spokespersons} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange(); }} />}
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
              <Avatar name={s.name} src={s.photo_url} size={48} className="bg-[#164FA3]/10 border border-gray-200 shrink-0" textClassName="text-[#164FA3]" />
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
    languages: editing.languages || "", photo_url: editing.photo_url || "",
  } : { name: "", mobile: "", languages: "", photo_url: "" });
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
      {/* Photo (BUG 26) — durable /api/uploads storage (media_files LONGBLOB) so
          it survives refresh, re-login and redeploys, and shows wherever this
          spokesperson is used (cards, debate/press-conference dropdowns). The
          live Avatar previews the current/updated photo; Remove clears only it. */}
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Photo</label>
        <div className="flex items-center gap-3">
          <Avatar name={form.name || "?"} src={form.photo_url} size={52} className="bg-[#164FA3]/10 border border-gray-200 shrink-0" textClassName="text-[#164FA3]" />
          <FileUpload
            value={form.photo_url}
            onChange={(url) => setForm({ ...form, photo_url: url })}
            endpoint="/api/uploads"
            accept="image/*"
            extRe={IMG_EXT_RE}
            formatMsg="Unsupported image. Use JPG, JPEG, PNG or WEBP."
          />
        </div>
        <p className="text-[10px] text-gray-400 mt-1">JPG, JPEG, PNG or WEBP — stored permanently.</p>
      </div>
      <ModalActions onClose={onClose} onSave={save} saving={saving} disabled={!form.name} />
    </Modal>
  );
}

// ============================================================ ANALYTICS
// BUG 16 — the lower Media Analytics section is a GRAPH VIEW (the old
// individual number-cards were removed). Every chart is driven by the live
// /api/media analytics payload and re-fetches with the Media Center date
// filter, so the graphs always match the database for the selected period.
const ACTIVITY_COLORS = { newspaper: "#164FA3", debate: "#F59E0B", conference: "#7C3AED" };
const SENTIMENT_COLORS = { Positive: "#10B981", Neutral: "#9CA3AF", Negative: "#EF4444" };

// Compact date label for a 'YYYY-MM-DD' string (used in the graph range caption).
function fmtReportDate(ymd) {
  if (!ymd) return "";
  const d = new Date(`${ymd}T00:00:00`);
  if (isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function AnalyticsTab({ data, filtered }) {
  const a = data.analytics || {};
  const series = Array.isArray(a.series) ? a.series : [];
  const meta = a.seriesMeta || {};
  const ds = a.debateStats || { positive: 0, neutral: 0, negative: 0 };
  const cov = a.counts || { positive: 0, neutral: 0, negative: 0 };

  // Range totals are the SUM of the same series the trend line draws, so the
  // "Total by Type" bars always equal the line (req 10 — totals match records).
  const totalNewspaper = series.reduce((s, r) => s + (Number(r.newspaper) || 0), 0);
  const totalDebate = series.reduce((s, r) => s + (Number(r.debate) || 0), 0);
  const totalConference = series.reduce((s, r) => s + (Number(r.conference) || 0), 0);
  const grandTotal = totalNewspaper + totalDebate + totalConference;

  const totalsData = [
    { type: "Newspaper", count: totalNewspaper, fill: ACTIVITY_COLORS.newspaper },
    { type: "TV Debate", count: totalDebate, fill: ACTIVITY_COLORS.debate },
    { type: "Press Conference", count: totalConference, fill: ACTIVITY_COLORS.conference },
  ];
  const sentimentData = [
    { name: "Newspaper", Positive: Number(cov.positive) || 0, Neutral: Number(cov.neutral) || 0, Negative: Number(cov.negative) || 0 },
    { name: "TV Debate", Positive: Number(ds.positive) || 0, Neutral: Number(ds.neutral) || 0, Negative: Number(ds.negative) || 0 },
  ];
  const hasSentiment = sentimentData.some((d) => d.Positive + d.Neutral + d.Negative > 0);

  const perLabel = { day: "day", week: "week", month: "month" }[meta.granularity] || "day";
  const rangeText = meta.from && meta.to
    ? `${fmtReportDate(meta.from)} – ${fmtReportDate(meta.to)}`
    : (filtered ? "the selected range" : "the last 30 days");

  return (
    <div className="space-y-6">
      {/* Chart 1 — Media Activity Over Time (Newspaper / TV Debate / Press
          Conference), one point per {day|week|month} across the selected range. */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><BarChart3 size={16} className="text-[#164FA3]" /> Media Activity Over Time</h3>
          <span className="text-xs text-gray-400">{rangeText} · per {perLabel}</span>
        </div>
        <p className="text-xs text-gray-500 mb-3">Newspaper, News Channel / TV Debate and Press Conference records — live from the database.</p>
        {grandTotal === 0 ? (
          <EmptyGraph label="No media activity recorded for this period." />
        ) : (
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 16, left: -8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F3F5" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#6B7280" }} interval="preserveStartEnd" minTickGap={24} tickLine={false} axisLine={{ stroke: "#E5E7EB" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6B7280" }} tickLine={false} axisLine={false} width={32} />
                <RTooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #E5E7EB" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="newspaper" name="Newspaper" stroke={ACTIVITY_COLORS.newspaper} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="debate" name="TV Debate" stroke={ACTIVITY_COLORS.debate} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="conference" name="Press Conference" stroke={ACTIVITY_COLORS.conference} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 2 — Total activity by type across the range. */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-1"><BarChart3 size={16} className="text-[#164FA3]" /> Total Activity by Type</h3>
          <p className="text-xs text-gray-500 mb-3">Records in {rangeText}.</p>
          {grandTotal === 0 ? (
            <EmptyGraph label="No activity to compare for this period." />
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={totalsData} margin={{ top: 8, right: 16, left: -8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F3F5" vertical={false} />
                  <XAxis dataKey="type" tick={{ fontSize: 11, fill: "#6B7280" }} tickLine={false} axisLine={{ stroke: "#E5E7EB" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6B7280" }} tickLine={false} axisLine={false} width={32} />
                  <RTooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #E5E7EB" }} cursor={{ fill: "#F8FAFC" }} />
                  <Bar dataKey="count" name="Records" radius={[6, 6, 0, 0]} maxBarSize={72}>
                    {totalsData.map((d) => <Cell key={d.type} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Chart 3 — Coverage sentiment & debate tone (positive / neutral /
            negative), from the sentiment on press_notes and the tone of each
            debate's news channel. */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-1"><BarChart3 size={16} className="text-[#164FA3]" /> Coverage Sentiment &amp; Debate Tone</h3>
          <p className="text-xs text-gray-500 mb-3">Positive / Neutral / Negative in {rangeText}.</p>
          {!hasSentiment ? (
            <EmptyGraph label="No sentiment-tagged coverage or debates for this period." />
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={sentimentData} margin={{ top: 8, right: 16, left: -8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F3F5" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6B7280" }} tickLine={false} axisLine={{ stroke: "#E5E7EB" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6B7280" }} tickLine={false} axisLine={false} width={32} />
                  <RTooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #E5E7EB" }} cursor={{ fill: "#F8FAFC" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Positive" stackId="s" fill={SENTIMENT_COLORS.Positive} radius={[0, 0, 0, 0]} maxBarSize={72} />
                  <Bar dataKey="Neutral" stackId="s" fill={SENTIMENT_COLORS.Neutral} maxBarSize={72} />
                  <Bar dataKey="Negative" stackId="s" fill={SENTIMENT_COLORS.Negative} radius={[6, 6, 0, 0]} maxBarSize={72} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChannelToneCard channels={a.channelTone || []} />
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-[#FCB712]" /> Top Spokespersons</h3>
          <ul className="space-y-2">
            {(a.topSpokespersons || []).length === 0 ? <li className="text-gray-400 text-sm">No debate data yet.</li> :
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

// Friendly placeholder so a period with no data never shows a blank chart area.
function EmptyGraph({ label }) {
  return (
    <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/50 text-sm text-gray-400 text-center px-4">
      {label}
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
const VIDEO_EXT_RE = /\.(mp4|webm)$/i;
const IMG_EXT_RE = /\.(jpe?g|png|webp)$/i;
function extFromUrl(u = "") { return (String(u).split(".").pop() || "").toLowerCase(); }

function FileUpload({ value, onChange, accept = ".pdf,image/*", endpoint = "/api/uploads", maxMB = 25, extRe = UPLOAD_EXT_RE, formatMsg = "Unsupported format. Use JPG, JPEG, PNG, WEBP or PDF." }) {
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
    if (!extRe.test(f.name || "")) {
      setErr(formatMsg);
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
  // BUG 20 — the Newspaper is already chosen (Upload via the newspaper card, or
  // Edit of an existing publication), so the form must NOT ask for it again. The
  // id is locked and shown read-only; uploads can't land on the wrong newspaper.
  const lockedNewspaperId = defaultNewspaperId ? String(defaultNewspaperId) : (editing?.newspaper_id ? String(editing.newspaper_id) : "");
  const lockedNewspaper = (newspapers || []).find((n) => String(n.id) === lockedNewspaperId) || null;
  const newspaperLocked = !!lockedNewspaperId;
  const [form, setForm] = useState(editing ? {
    title: editing.title || "", summary: editing.summary || "", kind: editing.kind || "press_note",
    newspaper_id: editing.newspaper_id ? String(editing.newspaper_id) : "",
    newspaper_name: "",
    // The publication's own saved Lok Sabha (pub_lok_sabha_id from the published
    // list, or lok_sabha_id from the media list); falls back to blank for legacy.
    lok_sabha_id: (editing.pub_lok_sabha_id ?? editing.lok_sabha_id) ? String(editing.pub_lok_sabha_id ?? editing.lok_sabha_id) : "",
    coverage_date: editing.coverage_date ? String(editing.coverage_date).slice(0, 10) : "",
    sentiment: editing.sentiment || "", file_url: editing.file_url || "",
  } : {
    title: "", summary: "", kind: "press_note",
    newspaper_id: defaultNewspaperId ? String(defaultNewspaperId) : "", newspaper_name: "",
    // Default the publication's Lok Sabha to the newspaper's mapped constituency
    // (when it maps to a specific one); still editable from the Master dropdown.
    lok_sabha_id: lockedNewspaper?.lok_sabha_id ? String(lockedNewspaper.lok_sabha_id) : "",
    coverage_date: new Date().toISOString().slice(0, 10), sentiment: "", file_url: "",
  });
  // Lok Sabha options come live from the existing Master Data — never hardcoded.
  const [lokOptions, setLokOptions] = useState([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/locations?type=lok_sabha")
      .then((r) => r.json())
      .then((d) => { if (alive) setLokOptions(d.locations || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isOther = !newspaperLocked && form.newspaper_id === NEWSPAPER_OTHER;

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
        lok_sabha_id: form.lok_sabha_id || "",
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
        {newspaperLocked ? (
          // Newspaper already chosen via the icon/card — read-only context, no
          // dropdown (§1/§2/§3/§8). The id is fixed to the selected newspaper.
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Newspaper</label>
            <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-800 flex items-center gap-2" title="Uploading for this newspaper">
              <Newspaper size={15} className="text-[#164FA3] shrink-0" />
              <span className="font-medium truncate">{lockedNewspaper?.name || "Selected newspaper"}</span>
              <span className="ml-auto text-[10px] uppercase tracking-wide text-gray-400">Selected</span>
            </div>
          </div>
        ) : (
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Newspaper</label>
            <select className={inp} value={form.newspaper_id} onChange={(e) => set("newspaper_id", e.target.value)}>
              <option value="">— Select newspaper —</option>
              {newspapers.map((n) => <option key={n.id} value={String(n.id)}>{n.name}</option>)}
              <option value={NEWSPAPER_OTHER}>Other…</option>
            </select>
          </div>
        )}
        {isOther && (
          <div className="col-span-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Other Newspaper Name *</label>
            <input className={inp} placeholder="Type the newspaper name" value={form.newspaper_name} onChange={(e) => set("newspaper_name", e.target.value)} />
          </div>
        )}
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Lok Sabha</label>
          <select className={inp} value={form.lok_sabha_id} onChange={(e) => set("lok_sabha_id", e.target.value)}>
            <option value="">— Select Lok Sabha —</option>
            {lokOptions.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
          </select>
          <p className="text-[10px] text-gray-400 mt-1">From the Lok Sabha Master.</p>
        </div>
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
  // BUG 23 — Schedule Debate is opened from a channel, so the Channel is already
  // known. It's locked (no dropdown) and shown read-only; channel_id is stored.
  const lockedChannelId = editing?.channel_id ? String(editing.channel_id) : (defaultChannelId ? String(defaultChannelId) : "");
  const lockedChannel = (channels || []).find((c) => String(c.id) === lockedChannelId) || null;
  const [form, setForm] = useState(editing ? {
    channel_id: editing.channel_id || "", topic: editing.topic || "",
    lok_sabha_id: editing.lok_sabha_id ? String(editing.lok_sabha_id) : (lockedChannel?.lok_sabha_id ? String(lockedChannel.lok_sabha_id) : ""),
    debate_date: editing.debate_date ? editing.debate_date.slice(0, 10) : "",
    debate_time: editing.debate_time ? editing.debate_time.slice(0, 5) : "20:00",
    brief_pdf_url: editing.brief_pdf_url || "",
    talking_points: editing.talking_points || "",
    status: editing.status || "scheduled",
    viral_score: editing.viral_score || 0,
    spokesperson_ids: (editing.spokespersons || []).map((s) => s.id),
  } : {
    channel_id: lockedChannelId, topic: "",
    // Default the debate's Lok Sabha to the channel's mapped constituency; still
    // editable from the Master dropdown.
    lok_sabha_id: lockedChannel?.lok_sabha_id ? String(lockedChannel.lok_sabha_id) : "",
    debate_date: "", debate_time: "20:00", brief_pdf_url: "", talking_points: "", spokesperson_ids: [],
  });
  // Lok Sabha options — live from the existing Master Data, never hardcoded.
  const [lokOptions, setLokOptions] = useState([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/locations?type=lok_sabha")
      .then((r) => r.json())
      .then((d) => { if (alive) setLokOptions(d.locations || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
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
          <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-800 flex items-center gap-2" title="This debate is scheduled for this channel">
            <Tv size={15} className="text-[#164FA3] shrink-0" />
            <span className="font-medium truncate">{lockedChannel?.name || "Selected channel"}</span>
            <span className="ml-auto text-[10px] uppercase tracking-wide text-gray-400">Selected</span>
          </div>
        </div>
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Lok Sabha</label>
          <select className={inp} value={form.lok_sabha_id} onChange={(e) => setForm({ ...form, lok_sabha_id: e.target.value })}>
            <option value="">— Select Lok Sabha —</option>
            {lokOptions.map((o) => <option key={o.id} value={String(o.id)}>{o.name}</option>)}
          </select>
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
  // spokesperson_ids is an array of id strings (§10.1). Seed from the saved
  // multi list when present, else fall back to the legacy single spokesperson.
  const seedIds = editing
    ? (Array.isArray(editing.spokespersons) && editing.spokespersons.length
        ? editing.spokespersons.map((s) => String(s.id))
        : (editing.spokesperson_id ? [String(editing.spokesperson_id)] : []))
    : [];
  const [form, setForm] = useState(editing ? {
    title: editing.title || "",
    conference_date: editing.conference_date ? new Date(editing.conference_date).toISOString().slice(0, 16) : "",
    venue: editing.venue || "",
    agenda: editing.agenda || "",
    status: editing.status || "scheduled",
    spokesperson_ids: seedIds,
    co_spokesperson: editing.co_spokesperson || "",
    video_url: editing.video_url || "",
  } : { title: "", conference_date: "", venue: "AAP State Office, Raipur", agenda: "", status: "scheduled", spokesperson_ids: [], co_spokesperson: "", video_url: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Active spokespersons for selection. When editing, include any saved
  // spokespersons even if now inactive, so their names still load in the picker.
  const spokesOptions = (() => {
    const active = (spokespersons || []).filter((s) => s.is_active == null || Number(s.is_active) === 1);
    const extra = (editing?.spokespersons || []).filter((s) => !active.some((a) => String(a.id) === String(s.id)));
    return [...extra.map((s) => ({ id: s.id, name: s.name, photo_url: s.photo_url, is_active: 0 })), ...active];
  })();
  const isDone = form.status === "completed";
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
        <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Spokesperson(s)</label>
        <SpokespersonMultiSelect options={spokesOptions} value={form.spokesperson_ids} onChange={(ids) => setForm({ ...form, spokesperson_ids: ids })} />
      </div>
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">Co-Spokesperson</label>
        <input className={inp} placeholder="Type a co-spokesperson name" value={form.co_spokesperson} onChange={(e) => setForm({ ...form, co_spokesperson: e.target.value })} />
      </div>
      {editing && (
        <select className={inp} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          <option value="scheduled">Scheduled</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      )}
      {/* Video upload (§10.3/§10.4). Available anytime, and highlighted once the
          conference is marked Completed so its recording can be attached. Stored
          durably (/api/media/uploads → media_files) and referenced by video_url. */}
      <div className={`rounded-xl border p-3 ${isDone ? "border-[#164FA3]/30 bg-[#164FA3]/5" : "border-gray-100 bg-gray-50/60"}`}>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1 block">
          Conference Video {isDone && <span className="text-[#164FA3]">· upload the recording</span>}
        </label>
        <FileUpload value={form.video_url} onChange={(url) => setForm({ ...form, video_url: url })} accept="video/mp4,video/webm" endpoint="/api/media/uploads" maxMB={200} extRe={VIDEO_EXT_RE} formatMsg="Unsupported format. Use MP4 or WEBM video." />
        {form.video_url && (
          <video src={form.video_url} controls className="mt-2 w-full rounded-lg max-h-56 bg-black" />
        )}
        <p className="text-[11px] text-gray-400 mt-1">MP4 or WEBM, up to 200 MB. Saved permanently and available after refresh/re-login.</p>
      </div>
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
