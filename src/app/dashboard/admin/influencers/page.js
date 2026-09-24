"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Star, Search, Plus, Filter, Eye, Pencil, Trash2, X, ChevronLeft, ChevronRight,
  Loader2, Shield, Phone, MapPin, Save, ArrowLeft, Users, CheckCircle2, Camera, ImagePlus,
} from "lucide-react";
import { normalizeRole, ROLES } from "@/lib/permissions";
import { usePageAccess } from "@/components/usePageAccess";
import PartySelect, { usePartyMaster, PartyLogo } from "@/components/PartySelect";
import { RatingScale, RatingBadge } from "@/components/KaryakartaRating";

// Colour used across the dashboard.
const BRAND = "#164FA3";

// A blank form matching the restructured profile: Profile Details, Political
// Journey, Social Activity, Economic Status, Influence Assessment + participation.
const BLANK = {
  name: "", phone: "", photo_url: "", address: "", assembly_id: "",
  age: "", caste: "", current_party: "",
  joined_by_phone: "", joined_by_contact_id: "",
  party_years: "", political_position: "", org_position: "", associated_since: "",
  social_media: "", team_size: "", social_reach: "",
  economic_status: "", influencer_rating: "",
  status: "Pending", join_date: "", cancelled_date: "", cancellation_remark: "", remark: "",
};

// The three canonical participation statuses → chip colour.
function statusChip(status) {
  const s = String(status || "").toLowerCase();
  if (s === "joined") return "bg-green-50 text-green-700 border-green-200";
  if (s === "cancelled") return "bg-red-50 text-red-700 border-red-200";
  return "bg-amber-50 text-amber-700 border-amber-200"; // Pending
}
// "24 Sep 2026" from a DATE (YYYY-MM-DD string or Date) without a timezone shift.
function fmtJoinDate(v) {
  if (!v) return "—";
  const ymd = String(v).slice(0, 10);
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return "—";
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(dt);
}
function ratingLabel(meta, value) {
  return meta?.potentialRatings?.find((r) => r.value === value)?.label || "—";
}

// A live dashboard summary card. `value` undefined → a subtle loading dash.
function StatCard({ label, value, tone }) {
  const toneCls = {
    brand: "bg-[#164FA3] text-white",
    green: "bg-white border border-green-200",
    amber: "bg-white border border-amber-200",
    red: "bg-white border border-red-200",
  }[tone] || "bg-white border border-gray-200";
  const valCls = tone === "brand" ? "text-white" : tone === "green" ? "text-green-700" : tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : "text-gray-900";
  const labelCls = tone === "brand" ? "text-blue-100" : "text-gray-500";
  return (
    <div className={`${toneCls} rounded-xl p-4 shadow-sm`}>
      <div className={`text-3xl font-bold ${valCls}`}>{value == null ? "—" : Number(value).toLocaleString("en-IN")}</div>
      <div className={`text-xs font-medium mt-1 ${labelCls}`}>{label}</div>
    </div>
  );
}

export default function InfluencersPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const isSuper = normalizeRole(session?.user?.role) === ROLES.SUPER_ADMIN;
  // Access mirrors the backend gate exactly: the effective "influencers" page key
  // (Super Admin + Supervisor by baseline, plus anyone granted it in Page Access).
  // Super Admin is a synchronous fast-path so their view never waits on /my-pages.
  const { has, loading: pagesLoading } = usePageAccess();
  const canAccess = isSuper || has("influencers");
  // Party master → resolve each row's party logo live (a logo change in Party
  // Master is reflected here immediately).
  const { byName: partyByName } = usePartyMaster();

  const [meta, setMeta] = useState(null);
  const [assemblies, setAssemblies] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // list controls
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fAssembly, setFAssembly] = useState("");
  const [fRating, setFRating] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  // panels
  const [mode, setMode] = useState("list"); // list | form
  const [editId, setEditId] = useState(null);
  const [viewRow, setViewRow] = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);
  const [stats, setStats] = useState(null); // { totals, assemblies } — live dashboard

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  // Load option sets + assemblies once (only for a user who can access the module).
  useEffect(() => {
    if (!canAccess) return;
    fetch("/api/influencers?meta=1", { cache: "no-store" })
      .then((r) => r.json()).then((d) => setMeta(d.meta || null)).catch(() => {});
    fetch("/api/locations?type=assembly", { cache: "no-store" })
      .then((r) => r.json()).then((d) => setAssemblies(d.locations || [])).catch(() => {});
  }, [canAccess]);

  const loadList = useCallback(async () => {
    if (!canAccess) return;
    setLoading(true); setErr("");
    try {
      const p = new URLSearchParams();
      p.set("page", String(page));
      p.set("pageSize", String(pageSize));
      if (debounced.trim()) p.set("search", debounced.trim());
      if (fStatus) p.set("status", fStatus);
      if (fAssembly) p.set("assembly_id", fAssembly);
      if (fRating) p.set("potential_rating", fRating);
      const r = await fetch(`/api/influencers?${p.toString()}`, { cache: "no-store" });
      if (r.status === 403) { setErr("You do not have access to this module."); setRows([]); setTotal(0); return; }
      if (!r.ok) throw new Error("load failed");
      const d = await r.json();
      setRows(d.influencers || []);
      setTotal(d.total || 0);
      setPages(d.pages || 1);
      if (d.meta) setMeta(d.meta);
    } catch {
      setErr("Could not load influencers. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [canAccess, page, pageSize, debounced, fStatus, fAssembly, fRating]);

  // Live dashboard counts (overall + per-assembly), recomputed from the DB.
  const loadStats = useCallback(async () => {
    if (!canAccess) return;
    try {
      const r = await fetch("/api/influencers?stats=1", { cache: "no-store" });
      if (r.ok) setStats(await r.json());
    } catch { /* keep last stats */ }
  }, [canAccess]);

  useEffect(() => { if (mode === "list") { loadList(); loadStats(); } }, [mode, loadList, loadStats]);

  async function openEdit(id) {
    setErr("");
    try {
      const r = await fetch(`/api/influencers/${id}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const d = await r.json();
      setEditRecord(d.influencer);
      setEditId(id);
      setMode("form");
    } catch {
      setErr("Could not open this influencer for editing.");
    }
  }
  const [editRecord, setEditRecord] = useState(null);

  async function doDelete() {
    if (!deleteRow) return;
    try {
      const r = await fetch(`/api/influencers/${deleteRow.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      setDeleteRow(null);
      loadList();
      loadStats();
    } catch {
      setErr("Could not delete this influencer.");
      setDeleteRow(null);
    }
  }

  // --- access gate (governed by the "influencers" page key) -----------------
  // Wait while the session or (for a non-super user) the effective page keys are
  // still loading, so an authorized Supervisor never sees a flash of Access Denied.
  if (authStatus === "loading" || (!isSuper && pagesLoading)) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin" style={{ color: BRAND }} size={28} /></div>;
  }
  if (!canAccess) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center">
        <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4"><Shield size={26} /></div>
          <h2 className="text-lg font-bold text-gray-900">Access Denied</h2>
          <p className="text-sm text-gray-500 mt-2">You do not have access to the Influencer module.</p>
          <button onClick={() => router.push("/dashboard")} className="mt-6 h-10 px-5 rounded-lg text-white text-sm font-semibold" style={{ background: BRAND }}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  if (mode === "form") {
    return (
      <InfluencerForm
        meta={meta}
        assemblies={assemblies}
        record={editId ? editRecord : null}
        onCancel={() => { setMode("list"); setEditId(null); setEditRecord(null); }}
        onSaved={(opts) => {
          setEditId(null); setEditRecord(null);
          if (opts?.created) {
            // On CREATE, clear any active search/filters and jump to the first page so
            // the just-created influencer is guaranteed to be on screen. Switching to
            // the list view (and the cleared filters) makes the list effect re-fetch
            // from the backend, so the row shown is the REAL DB record — never injected
            // into local state (Bug Fix §4). Because it is persisted, it also survives
            // refresh, logout/login, paging and filtering. (No manual loadList here —
            // that would fetch with the pre-reset filter closure and could race.)
            setSearch(""); setDebounced(""); setFStatus(""); setFAssembly(""); setFRating(""); setPage(1);
            setMode("list");
          } else {
            // EDIT keeps the current view; refetch from the backend so the change shows.
            setMode("list");
            loadList(); loadStats();
          }
        }}
      />
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white" style={{ background: BRAND }}><Star size={22} /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Influencer Dashboard</h1>
            <p className="text-sm text-gray-500">Live participation — Total, Joined, Pending, Cancelled</p>
          </div>
        </div>
        <button
          onClick={() => { setEditId(null); setEditRecord(null); setMode("form"); }}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-white text-sm font-semibold shadow-sm"
          style={{ background: BRAND }}
        >
          <Plus size={17} /> Add Influencer
        </button>
      </div>

      {/* Live summary cards — Total = Joined + Pending + Cancelled */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard label="Total Influencers" value={stats?.totals?.total} tone="brand" />
        <StatCard label="Joined" value={stats?.totals?.joined} tone="green" />
        <StatCard label="Pending" value={stats?.totals?.pending} tone="amber" />
        <StatCard label="Cancelled" value={stats?.totals?.cancelled} tone="red" />
      </div>

      {/* Assembly-wise Influencer Count — every master assembly, live counts */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <MapPin size={16} style={{ color: BRAND }} />
          <h2 className="text-sm font-bold text-gray-900">Assembly-wise Influencer Count</h2>
          <span className="ml-auto text-xs text-gray-400">Click an assembly to filter the list</span>
        </div>
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead className="bg-gray-50 text-left text-gray-500 text-[11px] uppercase tracking-wide sticky top-0">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Assembly</th>
                <th className="px-4 py-2.5 font-semibold text-right">Total</th>
                <th className="px-4 py-2.5 font-semibold text-right">Joined</th>
                <th className="px-4 py-2.5 font-semibold text-right">Pending</th>
                <th className="px-4 py-2.5 font-semibold text-right">Cancelled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!stats ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400"><Loader2 className="animate-spin inline" size={18} /></td></tr>
              ) : stats.assemblies.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No assemblies found.</td></tr>
              ) : stats.assemblies.map((a) => (
                <tr key={a.assembly_id} className={`hover:bg-gray-50 ${String(fAssembly) === String(a.assembly_id) ? "bg-blue-50/60" : ""}`}>
                  <td className="px-4 py-2.5">
                    <button onClick={() => { setFAssembly(String(a.assembly_id)); setPage(1); }} className="font-medium text-[#164FA3] hover:underline text-left">
                      {a.assembly_name || "—"}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{a.total}</td>
                  <td className="px-4 py-2.5 text-right text-green-700">{a.joined}</td>
                  <td className="px-4 py-2.5 text-right text-amber-700">{a.pending}</td>
                  <td className="px-4 py-2.5 text-right text-red-700">{a.cancelled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative lg:col-span-1 md:col-span-2">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, assembly…"
              className="w-full pl-9 pr-3 h-10 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2"
              style={{ boxShadow: "none" }}
            />
          </div>
          <select value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); }} className="h-10 rounded-lg border border-gray-200 text-sm px-2 text-gray-700">
            <option value="">All statuses</option>
            {(meta?.statuses || []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={fAssembly} onChange={(e) => { setFAssembly(e.target.value); setPage(1); }} className="h-10 rounded-lg border border-gray-200 text-sm px-2 text-gray-700">
            <option value="">All assemblies</option>
            {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={fRating} onChange={(e) => { setFRating(e.target.value); setPage(1); }} className="h-10 rounded-lg border border-gray-200 text-sm px-2 text-gray-700">
            <option value="">All influence levels</option>
            {(meta?.potentialRatings || []).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        {(fStatus || fAssembly || fRating || search) && (
          <button
            onClick={() => { setSearch(""); setFStatus(""); setFAssembly(""); setFRating(""); setPage(1); }}
            className="mt-3 text-xs font-medium text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
          >
            <X size={13} /> Clear filters
          </button>
        )}
      </div>

      {err && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{err}</div>}

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-semibold">Assembly</th>
                <th className="px-4 py-3 font-semibold">Influencer Name</th>
                <th className="px-4 py-3 font-semibold">Mobile Number</th>
                <th className="px-4 py-3 font-semibold">Party</th>
                <th className="px-4 py-3 font-semibold">Joined By</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-16 text-center text-gray-400"><Loader2 className="animate-spin inline" size={22} /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-16 text-center text-gray-400">
                  <Users size={30} className="mx-auto mb-2 opacity-40" />
                  No influencers found.
                </td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600">{r.assembly_name || "—"}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div className="flex items-center gap-2.5">
                      <Thumb src={r.photo_url} name={r.name} />
                      <span>{r.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{r.phone || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{r.current_party ? <PartyLogo name={r.current_party} byName={partyByName} /> : "—"}</td>
                  <td className="px-4 py-3">
                    {r.joined_by_name ? (
                      <div className="flex items-center gap-2.5 min-w-[180px]">
                        <Thumb src={r.joined_by_photo} name={r.joined_by_name} size={38} />
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 text-sm truncate">{r.joined_by_name}</div>
                          <div className="text-xs text-gray-500 truncate">{r.joined_by_designation || "—"}</div>
                          <div className="text-[11px] text-gray-400 inline-flex items-center gap-1">
                            {r.joined_by_mobile ? <><Phone size={10} /> {r.joined_by_mobile}</> : "—"}
                          </div>
                        </div>
                      </div>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setViewRow(r)} title="View" className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500"><Eye size={16} /></button>
                      <button onClick={() => openEdit(r.id)} title="Edit" className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500"><Pencil size={16} /></button>
                      <button onClick={() => setDeleteRow(r)} title="Delete" className="p-1.5 rounded-md hover:bg-red-50 text-red-500"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
            <span>Page {page} of {pages} · {total} total</span>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="p-1.5 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><ChevronLeft size={16} /></button>
              <button disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} className="p-1.5 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </div>

      {/* View modal */}
      {viewRow && <ViewModal row={viewRow} meta={meta} onClose={() => setViewRow(null)} onEdit={() => { const id = viewRow.id; setViewRow(null); openEdit(id); }} />}

      {/* Delete confirm */}
      {deleteRow && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDeleteRow(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-4"><Trash2 size={22} /></div>
            <h3 className="text-lg font-bold text-gray-900">Delete influencer?</h3>
            <p className="text-sm text-gray-500 mt-1">This permanently removes <strong>{deleteRow.name}</strong> and all their profile data. This cannot be undone.</p>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setDeleteRow(null)} className="h-9 px-4 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={doDelete} className="h-9 px-4 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit form
// ---------------------------------------------------------------------------
function InfluencerForm({ meta, assemblies, record, onCancel, onSaved }) {
  const editing = !!record;
  const [f, setF] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // "Joined By" — the resolved existing Contact (live link) and lookup status.
  const [joinedBy, setJoinedBy] = useState(null); // compact contact card | null
  const [jbStatus, setJbStatus] = useState("idle"); // idle | loading | found | notfound | invalid

  useEffect(() => {
    if (record) {
      // Coalesce every known field so a NULL from the database (e.g. an influencer
      // with no phone / address / caste) becomes the blank-form default instead of
      // null — otherwise `f.phone.trim()` etc. throw and the Save never fires.
      const norm = {};
      for (const k of Object.keys(BLANK)) norm[k] = record[k] ?? BLANK[k];
      setF({
        ...norm,
        assembly_id: record.assembly_id != null ? String(record.assembly_id) : "",
        age: record.age != null ? String(record.age) : "",
        joined_by_phone: record.joined_by_phone || "",
        joined_by_contact_id: record.joined_by_contact_id != null ? String(record.joined_by_contact_id) : "",
        remark: record.remark || "",
        join_date: record.join_date ? String(record.join_date).slice(0, 10) : "",
        cancelled_date: record.cancelled_date ? String(record.cancelled_date).slice(0, 10) : "",
      });
      setJoinedBy(record.joined_by_contact || null);
      setJbStatus(record.joined_by_contact ? "found" : "idle");
    } else {
      setF(BLANK);
      setJoinedBy(null);
      setJbStatus("idle");
    }
  }, [record]);

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  // Look up the "Joined By" contact from the entered phone (debounced). A valid
  // 10-digit number searches Contacts; a hit links the EXISTING contact (id) and
  // shows its live details, a miss shows "Contact Not Found" and clears the link —
  // a contact is never created here.
  useEffect(() => {
    const raw = String(f.joined_by_phone || "").replace(/\D/g, "");
    if (!raw) { setJbStatus("idle"); setJoinedBy(null); set("joined_by_contact_id", ""); return; }
    if (raw.length < 10) { setJbStatus("invalid"); setJoinedBy(null); set("joined_by_contact_id", ""); return; }
    let alive = true;
    setJbStatus("loading");
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/influencers/contact-lookup?phone=${encodeURIComponent(raw)}`, { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (d.found && d.contact) { setJoinedBy(d.contact); setJbStatus("found"); set("joined_by_contact_id", String(d.contact.id)); }
        else { setJoinedBy(null); setJbStatus(d.invalid ? "invalid" : "notfound"); set("joined_by_contact_id", ""); }
      } catch { if (alive) { setJoinedBy(null); setJbStatus("notfound"); set("joined_by_contact_id", ""); } }
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [f.joined_by_phone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resolved location chain (District / Lok Sabha / Zone) for the selected
  // Assembly — fetched from the backend/master data, never hardcoded. Refetches
  // whenever the Assembly changes so stale values from a previous pick are
  // replaced. `null` = still loading; empty fields = "Not mapped".
  const [loc, setLoc] = useState(null);
  useEffect(() => {
    const aid = f.assembly_id;
    if (!aid) { setLoc(null); return; }
    let alive = true;
    setLoc(null);
    fetch(`/api/influencers?location_of=${aid}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (alive) setLoc(d.location || {}); })
      .catch(() => { if (alive) setLoc({}); });
    return () => { alive = false; };
  }, [f.assembly_id]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    // Guard against null values defensively — a field can be null if it was ever
    // set outside the normalized form load.
    if (!String(f.name || "").trim()) { setError("Name is required."); return; }
    const phone = String(f.phone || "").trim();
    if (phone) {
      const digits = phone.replace(/[^0-9]/g, "");
      if (digits.length < 7 || digits.length > 15) { setError("Enter a valid phone number."); return; }
    }
    // Cancelled requires a reason/remark before saving (§12) — the backend enforces
    // this too, so a client bypass is still rejected.
    if (f.status === "Cancelled" && !String(f.cancellation_remark || "").trim()) {
      setError("Please enter a cancellation reason/remark before saving."); return;
    }
    setSaving(true);
    try {
      const body = { ...f, assembly_id: f.assembly_id || null };
      const url = editing ? `/api/influencers/${record.id}` : "/api/influencers";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      // Only treat it as saved when the API confirms it AND returns the persisted
      // record — never show success on a failed insert (Bug Fix §2, §7).
      if (!r.ok || !d.influencer) { setError(d.message || "Could not save. Please try again."); setSaving(false); return; }
      onSaved({ created: !editing, influencer: d.influencer });
    } catch {
      setError("Could not save. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="max-w-[1000px] mx-auto pb-16">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onCancel} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><ArrowLeft size={20} /></button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{editing ? "Edit Influencer" : "Add Influencer"}</h1>
          <p className="text-sm text-gray-500">{editing ? "Update the profile — existing data is preserved." : "Create a new influencer profile."}</p>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{error}</div>}

      <form onSubmit={submit} className="space-y-5">
        {/* Profile Details */}
        <Section title="Profile Details">
          <Field label="Photo">
            <PhotoUpload value={f.photo_url} name={f.name} onChange={(url) => set("photo_url", url)} />
          </Field>
          <Grid>
            <Field label="Influencer Name" required>
              <input value={f.name} onChange={(e) => set("name", e.target.value)} className={inputCls} placeholder="Full name" />
            </Field>
            <Field label="Phone">
              <input value={f.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} placeholder="Contact number" />
            </Field>
            <Field label="Assembly Name">
              <select value={f.assembly_id} onChange={(e) => set("assembly_id", e.target.value)} className={inputCls}>
                <option value="">Select assembly</option>
                {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            {/* Auto-resolved from the selected Assembly (read-only). */}
            <Field label="District (auto)">
              <ReadOnly loading={f.assembly_id && loc === null} value={loc?.district_name} empty={f.assembly_id ? "Not mapped" : "Select an assembly"} />
            </Field>
            <Field label="Age">
              <input type="number" min="1" max="120" value={f.age} onChange={(e) => set("age", e.target.value)} className={inputCls} placeholder="Age" />
            </Field>
            <Field label="Caste">
              <input value={f.caste} onChange={(e) => set("caste", e.target.value)} className={inputCls} placeholder="Caste" />
            </Field>
          </Grid>
          {/* Current Party — Party Logo is shown automatically from the Party Master. */}
          <Field label="Current Party">
            <PartySelect value={f.current_party} onChange={(name) => set("current_party", name)} placeholder="Select a party" />
            <p className="text-[11px] text-gray-400 mt-1">The party logo is displayed automatically based on the selected party.</p>
          </Field>
          <Field label="Address">
            <textarea value={f.address} onChange={(e) => set("address", e.target.value)} className={areaCls} rows={2} placeholder="Full address" />
          </Field>
          {editing && (
            <Field label="Added By">
              <ReadOnly value={record?.created_by_name} empty="—" />
            </Field>
          )}
        </Section>

        {/* Joined By — enter a phone number to find & LINK an existing Contact. */}
        <Section title="Joined By">
          <Field label="Joined By (Contact Phone Number)">
            <input
              value={f.joined_by_phone}
              onChange={(e) => set("joined_by_phone", e.target.value)}
              className={inputCls}
              inputMode="numeric"
              placeholder="Enter the contact's phone number"
            />
            <p className="text-[11px] text-gray-400 mt-1">Enter a phone number to search Contacts and link the existing record — no duplicate contact is created.</p>
          </Field>
          <JoinedByPreview status={jbStatus} contact={joinedBy} />
        </Section>

        {/* Political Journey */}
        <Section title="Political Journey">
          <Grid>
            <Field label="Number of years associated with the party">
              <input value={f.party_years} onChange={(e) => set("party_years", e.target.value)} className={inputCls} placeholder="e.g. 8" />
            </Field>
            <Field label="Since when associated">
              <input value={f.associated_since} onChange={(e) => set("associated_since", e.target.value)} className={inputCls} placeholder="e.g. 2015" />
            </Field>
            <Field label="Current Political Position / Post">
              <input value={f.political_position} onChange={(e) => set("political_position", e.target.value)} className={inputCls} placeholder="Political position / post held" />
            </Field>
            <Field label="Current Post / Position in the Organisation">
              <input value={f.org_position} onChange={(e) => set("org_position", e.target.value)} className={inputCls} placeholder="Organisational post / position" />
            </Field>
          </Grid>
        </Section>

        {/* Social Activity */}
        <Section title="Social Activity">
          <Grid>
            <Field label="Social Media Platform / Profile">
              <input value={f.social_media} onChange={(e) => set("social_media", e.target.value)} className={inputCls} placeholder="Platform / handle / profile link" />
            </Field>
            <Field label="Team Size">
              <input value={f.team_size} onChange={(e) => set("team_size", e.target.value)} className={inputCls} placeholder="e.g. 25" />
            </Field>
          </Grid>
          <Field label="Social Reach or Community Engagement">
            <textarea value={f.social_reach} onChange={(e) => set("social_reach", e.target.value)} className={areaCls} rows={2} placeholder="Reach, followers, community engagement…" />
          </Field>
        </Section>

        {/* Economic Status (sensitive) */}
        <Section title="Economic Status" note="Sensitive — visible to Super Admin only">
          <Grid>
            <Field label="Economic Status">
              <select value={f.economic_status} onChange={(e) => set("economic_status", e.target.value)} className={inputCls}>
                <option value="">Select</option>
                {(meta?.economicStatuses || []).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </Grid>
        </Section>

        {/* Influencer Rating — a 1–10 green scale (darker as the rating rises). */}
        <Section title="Influencer Rating">
          <Field label="Influencer Rating (1–10)">
            <RatingScale value={f.influencer_rating} onChange={(v) => set("influencer_rating", v)} />
            <p className="text-[11px] text-gray-400 mt-1.5">Select a rating from 1 to 10 — the colour gets stronger/darker as the rating increases.</p>
          </Field>
        </Section>

        {/* Participation status — the Status dropdown is intentionally NOT shown in
            this form. A new influencer keeps its default status, and an existing
            record keeps whatever status it already has; the rest of the section
            (Join Date, Cancellation Reason, Remark) is unchanged and still appears
            for records already in that status. */}
        <Section title="Participation Status">
          <Grid>
            {/* Joined → record the join date (auto-stamped on save if left blank). */}
            {f.status === "Joined" && (
              <Field label="Join Date">
                <input type="date" value={(f.join_date || "").slice(0, 10)} onChange={(e) => set("join_date", e.target.value)} className={inputCls} />
                <p className="text-[11px] text-gray-400 mt-1">Set automatically to today if left blank.</p>
              </Field>
            )}
            {/* Cancelled → a reason/remark is required before it can be saved (§12). */}
            {f.status === "Cancelled" && (
              <Field label="Cancellation Reason / Remark" required full>
                <textarea value={f.cancellation_remark || ""} onChange={(e) => set("cancellation_remark", e.target.value)} className={areaCls} rows={2} placeholder="Why was this cancelled? (required)" />
              </Field>
            )}
          </Grid>
          {/* General remark — participation / follow-up / communication / joining
              notes. Free multiline; saved with the record and shown on view/edit. */}
          <Field label="Remark">
            <textarea value={f.remark || ""} onChange={(e) => set("remark", e.target.value)} className={areaCls} rows={3}
                      placeholder="Notes on participation, follow-up, communication, joining status, or anything else relevant…" />
          </Field>
        </Section>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="h-10 px-5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 h-10 px-5 rounded-lg text-white text-sm font-semibold disabled:opacity-60" style={{ background: BRAND }}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {editing ? "Save Changes" : "Create Influencer"}
          </button>
        </div>
      </form>
    </div>
  );
}

// "Joined By" lookup result — the linked existing Contact's live details, or a
// clear status message. Never a create prompt: a miss just says "Contact Not Found".
function JoinedByPreview({ status, contact }) {
  if (contact) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50/60 p-3">
        <div className="flex items-center gap-3">
          <Thumb src={contact.photo_url} name={contact.person_name} size={48} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900">{contact.person_name || "—"}</span>
              <span className="text-[11px] font-semibold text-green-700 inline-flex items-center gap-1"><CheckCircle2 size={13} /> Linked from Contacts</span>
            </div>
            <div className="text-xs text-gray-600 mt-0.5">{contact.phone_number || "—"}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-xs">
          <div><span className="text-gray-400">Assembly: </span><span className="text-gray-800">{contact.assembly_name || "—"}</span></div>
          <div><span className="text-gray-400">District: </span><span className="text-gray-800">{contact.district_name || "—"}</span></div>
          <div><span className="text-gray-400">Lok Sabha: </span><span className="text-gray-800">{contact.lok_sabha_name || "—"}</span></div>
          <div><span className="text-gray-400">Zone: </span><span className="text-gray-800">{contact.zone_name || "—"}</span></div>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">These details are read live from the linked Contact and are not duplicated onto the influencer.</p>
      </div>
    );
  }
  if (status === "loading") return <div className="text-sm text-gray-500 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Searching Contacts…</div>;
  if (status === "notfound") return <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2 font-medium">Contact Not Found — no matching contact for this number. A duplicate contact is not created.</div>;
  if (status === "invalid") return <div className="text-xs text-gray-400">Enter a valid 10-digit phone number to search.</div>;
  return null;
}

// ---------------------------------------------------------------------------
// View modal
// ---------------------------------------------------------------------------
function ViewModal({ row, meta, onClose, onEdit }) {
  const { byName: partyByName } = usePartyMaster();
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <Thumb src={row.photo_url} name={row.name} size={48} />
            <div>
              <h3 className="text-lg font-bold text-gray-900">{row.name}</h3>
              <div className="flex items-center gap-3 text-sm text-gray-500 mt-0.5">
                {row.phone && <span className="inline-flex items-center gap-1"><Phone size={13} /> {row.phone}</span>}
                {row.assembly_name && <span className="inline-flex items-center gap-1"><MapPin size={13} /> {row.assembly_name}</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400"><X size={20} /></button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-5 text-sm">
          <div className="flex flex-wrap gap-2">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${statusChip(row.status)}`}>{row.status}</span>
            {row.influencer_rating != null && row.influencer_rating !== ""
              ? <span className="inline-flex items-center gap-1 text-xs text-gray-500">Rating: <RatingBadge value={row.influencer_rating} /></span>
              : row.potential_rating ? <span className="px-2 py-0.5 rounded-full text-xs font-medium border bg-indigo-50 text-indigo-700 border-indigo-200">Influence: {ratingLabel(meta, row.potential_rating)}</span> : null}
          </div>

          {/* Profile Details */}
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Profile Details</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <ViewInline label="Assembly" value={row.assembly_name} />
              <ViewInline label="Added By" value={row.created_by_name} />
              <ViewInline label="Age" value={row.age != null ? String(row.age) : ""} />
              <ViewInline label="Caste" value={row.caste} />
              <ViewInline label="Joined By" value={row.joined_by_name || row.joined_by_phone} />
            </div>
            {row.current_party && (
              <div className="mt-1"><span className="text-gray-400">Current Party: </span><span className="inline-flex align-middle"><PartyLogo name={row.current_party} byName={partyByName} /></span></div>
            )}
          </div>

          {/* Participation — Join / Cancellation info */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {row.status === "Joined" && <ViewInline label="Join Date" value={fmtJoinDate(row.join_date)} />}
            {row.status === "Cancelled" && <ViewInline label="Cancelled Date" value={fmtJoinDate(row.cancelled_date)} />}
          </div>
          {row.status === "Cancelled" && <ViewBlock label="Cancellation Reason" value={row.cancellation_remark} />}
          <ViewBlock label="Remark" value={row.remark} />

          {/* Location (auto-resolved from Assembly) */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <ViewInline label="District" value={row.district_name} />
            <ViewInline label="Lok Sabha" value={row.lok_sabha_name} />
            <ViewInline label="Zone" value={row.zone_name} />
          </div>
          <ViewBlock label="Address" value={row.address} />

          {/* Political Journey */}
          {(row.party_years || row.associated_since || row.political_position || row.org_position) && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Political Journey</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-700">
                <ViewInline label="Years with party" value={row.party_years} />
                <ViewInline label="Associated since" value={row.associated_since} />
                <ViewInline label="Political Position / Post" value={row.political_position} />
                <ViewInline label="Post in Organisation" value={row.org_position} />
              </div>
            </div>
          )}

          {/* Social Activity */}
          {(row.social_media || row.team_size || row.social_reach) && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Social Activity</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-700">
                <ViewInline label="Social Media" value={row.social_media} />
                <ViewInline label="Team Size" value={row.team_size} />
              </div>
              {row.social_reach && <p className="text-gray-700 mt-1 whitespace-pre-wrap">{row.social_reach}</p>}
            </div>
          )}

          <ViewBlock label="Economic Status" value={row.economic_status} />
        </div>

        <div className="flex justify-end gap-2 px-6 py-3 border-t border-gray-100">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">Close</button>
          <button onClick={onEdit} className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-white text-sm font-semibold" style={{ background: BRAND }}><Pencil size={15} /> Edit</button>
        </div>
      </div>
    </div>
  );
}

// --- small presentational helpers ------------------------------------------
const inputCls = "w-full h-10 rounded-lg border border-gray-200 text-sm px-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300";
const areaCls = "w-full rounded-lg border border-gray-200 text-sm px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300";

function Section({ title, note, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        {note && <span className="text-xs text-amber-600 font-medium">{note}</span>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
function Grid({ children }) { return <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>; }
function Field({ label, required, full, children }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
    </div>
  );
}
function ViewBlock({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">{label}</div>
      <p className="text-gray-700 whitespace-pre-wrap">{value}</p>
    </div>
  );
}
function ViewInline({ label, value }) {
  if (!value) return null;
  return <div><span className="text-gray-400">{label}: </span><span className="text-gray-800 font-medium">{value}</span></div>;
}

// Round photo thumbnail with a clean initial-letter placeholder fallback.
function Thumb({ src, name, size = 32 }) {
  const [ok, setOk] = useState(true);
  const px = { width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.4)) };
  if (src && ok) {
    return <img src={src} alt={name || ""} loading="lazy" style={{ width: size, height: size }} className="rounded-full object-cover border border-gray-200 bg-white shrink-0" onError={() => setOk(false)} />;
  }
  return <div style={px} className="rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-[#164FA3] font-bold shrink-0">{String(name || "?").trim().charAt(0).toUpperCase() || "?"}</div>;
}

// Read-only display box for the auto-resolved location fields.
function ReadOnly({ value, empty, loading }) {
  return (
    <div className="w-full h-10 rounded-lg border border-gray-200 bg-gray-50 text-sm px-3 flex items-center text-gray-700">
      {loading ? <span className="text-gray-400 inline-flex items-center gap-1"><Loader2 size={13} className="animate-spin" /> Resolving…</span>
        : value ? value : <span className="text-gray-400">{empty || "—"}</span>}
    </div>
  );
}

// Photo upload with live preview. Uploads to the shared persistent photo store
// (/api/users/photo → user_photos blob, served via /uploads/<id>) and hands the
// stored URL back — never a temporary device path, so it survives refresh/login.
function PhotoUpload({ value, name, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setErr("Image too large (max 5 MB)."); return; }
    setErr(""); setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch("/api/users/photo", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || "Upload failed."); return; }
      onChange(d.url);
    } catch { setErr("Upload failed. Please try again."); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex items-center gap-4">
      <Thumb src={value} name={name} size={72} />
      <div className="space-y-1">
        <div className="flex gap-2">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
            className="h-9 px-3 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />} {value ? "Change Photo" : "Upload Photo"}
          </button>
          {value && !busy && <button type="button" onClick={() => onChange("")} className="h-9 px-3 rounded-lg border border-gray-200 text-sm font-medium text-gray-500 hover:bg-gray-50">Remove</button>}
        </div>
        <p className="text-[11px] text-gray-400">JPG, PNG or WEBP · up to 5 MB</p>
        {err && <p className="text-[11px] text-red-500">{err}</p>}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
    </div>
  );
}
