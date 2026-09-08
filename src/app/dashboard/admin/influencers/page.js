"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Star, Search, Plus, Filter, Eye, Pencil, Trash2, X, ChevronLeft, ChevronRight,
  Loader2, Shield, Phone, MapPin, Save, ArrowLeft, Users, CheckCircle2, Camera, ImagePlus,
} from "lucide-react";
import { normalizeRole, ROLES } from "@/lib/permissions";

// Colour used across the dashboard.
const BRAND = "#164FA3";

// A blank form matching every DB field. key_activities is an array of strings
// (4–5 entries); the conditional election block is only saved when contested.
const BLANK = {
  name: "", phone: "", photo_url: "", address: "", assembly_id: "", influence_position: "",
  key_activities: ["", "", "", "", ""], political_journey: "",
  contested_election: false, election_type: "", election_year: "", election_constituency: "",
  election_party: "", election_result: "", election_votes: "", election_details: "",
  org_social_activity: "", economic_status: "", economic_profile: "",
  potential_rating: "", potential_areas: "", expected_contribution: "", potential_remarks: "",
  status: "New", next_action: "", action_remarks: "", follow_up_date: "", responsible_person: "",
};

// Status → chip colour.
function statusChip(status) {
  const s = String(status || "").toLowerCase();
  if (["joined", "interested"].some((x) => s.includes(x))) return "bg-green-50 text-green-700 border-green-200";
  if (["rejected", "not interested", "closed"].some((x) => s.includes(x))) return "bg-red-50 text-red-700 border-red-200";
  if (["contacted", "meeting", "discussion", "shortlisted"].some((x) => s.includes(x))) return "bg-blue-50 text-blue-700 border-blue-200";
  if (["hold", "assessment", "contact required"].some((x) => s.includes(x))) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-gray-100 text-gray-600 border-gray-200";
}
function ratingLabel(meta, value) {
  return meta?.potentialRatings?.find((r) => r.value === value)?.label || "—";
}

export default function InfluencersPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const isSuper = normalizeRole(session?.user?.role) === ROLES.SUPER_ADMIN;

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
  const [fAction, setFAction] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  // panels
  const [mode, setMode] = useState("list"); // list | form
  const [editId, setEditId] = useState(null);
  const [viewRow, setViewRow] = useState(null);
  const [deleteRow, setDeleteRow] = useState(null);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  // Load option sets + assemblies once (super only).
  useEffect(() => {
    if (!isSuper) return;
    fetch("/api/influencers?meta=1", { cache: "no-store" })
      .then((r) => r.json()).then((d) => setMeta(d.meta || null)).catch(() => {});
    fetch("/api/locations?type=assembly", { cache: "no-store" })
      .then((r) => r.json()).then((d) => setAssemblies(d.locations || [])).catch(() => {});
  }, [isSuper]);

  const loadList = useCallback(async () => {
    if (!isSuper) return;
    setLoading(true); setErr("");
    try {
      const p = new URLSearchParams();
      p.set("page", String(page));
      p.set("pageSize", String(pageSize));
      if (debounced.trim()) p.set("search", debounced.trim());
      if (fStatus) p.set("status", fStatus);
      if (fAssembly) p.set("assembly_id", fAssembly);
      if (fRating) p.set("potential_rating", fRating);
      if (fAction) p.set("next_action", fAction);
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
  }, [isSuper, page, pageSize, debounced, fStatus, fAssembly, fRating, fAction]);

  useEffect(() => { if (mode === "list") loadList(); }, [mode, loadList]);

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
    } catch {
      setErr("Could not delete this influencer.");
      setDeleteRow(null);
    }
  }

  // --- access gate (super admin only) --------------------------------------
  if (authStatus === "loading") {
    return <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin" style={{ color: BRAND }} size={28} /></div>;
  }
  if (!isSuper) {
    return (
      <div className="flex h-full min-h-[60vh] items-center justify-center">
        <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4"><Shield size={26} /></div>
          <h2 className="text-lg font-bold text-gray-900">Access Denied</h2>
          <p className="text-sm text-gray-500 mt-2">The Influencer module is restricted to the Super Admin.</p>
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
        onSaved={() => { setMode("list"); setEditId(null); setEditRecord(null); loadList(); }}
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
            <h1 className="text-xl font-bold text-gray-900">Influencers</h1>
            <p className="text-sm text-gray-500">{total} record{total === 1 ? "" : "s"} · Super Admin only</p>
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

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
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
            <option value="">All potential</option>
            {(meta?.potentialRatings || []).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <select value={fAction} onChange={(e) => { setFAction(e.target.value); setPage(1); }} className="h-10 rounded-lg border border-gray-200 text-sm px-2 text-gray-700">
            <option value="">All next actions</option>
            {(meta?.nextActions || []).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {(fStatus || fAssembly || fRating || fAction || search) && (
          <button
            onClick={() => { setSearch(""); setFStatus(""); setFAssembly(""); setFRating(""); setFAction(""); setPage(1); }}
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
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 font-semibold">Assembly</th>
                <th className="px-4 py-3 font-semibold">District</th>
                <th className="px-4 py-3 font-semibold">Potential</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Next Action</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-gray-400"><Loader2 className="animate-spin inline" size={22} /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-gray-400">
                  <Users size={30} className="mx-auto mb-2 opacity-40" />
                  No influencers found.
                </td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div className="flex items-center gap-2.5">
                      <Thumb src={r.photo_url} name={r.name} />
                      <span>{r.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.phone || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{r.assembly_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{r.district_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{ratingLabel(meta, r.potential_rating)}</td>
                  <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${statusChip(r.status)}`}>{r.status || "—"}</span></td>
                  <td className="px-4 py-3 text-gray-600 max-w-[150px] truncate">{r.next_action || "—"}</td>
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

  useEffect(() => {
    if (record) {
      const acts = Array.isArray(record.key_activities) ? record.key_activities : [];
      const padded = [...acts];
      while (padded.length < 5) padded.push("");
      setF({
        ...BLANK, ...record,
        assembly_id: record.assembly_id != null ? String(record.assembly_id) : "",
        contested_election: !!record.contested_election,
        key_activities: padded,
        follow_up_date: record.follow_up_date ? String(record.follow_up_date).slice(0, 10) : "",
      });
    } else {
      setF(BLANK);
    }
  }, [record]);

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setAct = (i, v) => setF((p) => { const a = [...p.key_activities]; a[i] = v; return { ...p, key_activities: a }; });

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
    if (!f.name.trim()) { setError("Name is required."); return; }
    if (f.phone.trim()) {
      const digits = f.phone.replace(/[^0-9]/g, "");
      if (digits.length < 7 || digits.length > 15) { setError("Enter a valid phone number."); return; }
    }
    setSaving(true);
    try {
      const body = {
        ...f,
        key_activities: f.key_activities.map((s) => s.trim()).filter(Boolean),
        assembly_id: f.assembly_id || null,
      };
      const url = editing ? `/api/influencers/${record.id}` : "/api/influencers";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.message || "Could not save. Please try again."); setSaving(false); return; }
      onSaved();
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
        {/* Basic info */}
        <Section title="Basic Information">
          {/* Photo */}
          <Field label="Photo">
            <PhotoUpload value={f.photo_url} name={f.name} onChange={(url) => set("photo_url", url)} />
          </Field>
          <Grid>
            <Field label="Name" required>
              <input value={f.name} onChange={(e) => set("name", e.target.value)} className={inputCls} placeholder="Full name" />
            </Field>
            <Field label="Phone">
              <input value={f.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} placeholder="Contact number" />
            </Field>
          </Grid>
          <Field label="Address">
            <textarea value={f.address} onChange={(e) => set("address", e.target.value)} className={areaCls} rows={2} placeholder="Full address" />
          </Field>
          <Grid>
            <Field label="Assembly">
              <select value={f.assembly_id} onChange={(e) => set("assembly_id", e.target.value)} className={inputCls}>
                <option value="">Select assembly</option>
                {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            {/* Auto-resolved from the selected Assembly (read-only). */}
            <Field label="District (auto)">
              <ReadOnly loading={f.assembly_id && loc === null} value={loc?.district_name} empty={f.assembly_id ? "Not mapped" : "Select an assembly"} />
            </Field>
            <Field label="Lok Sabha (auto)">
              <ReadOnly loading={f.assembly_id && loc === null} value={loc?.lok_sabha_name} empty={f.assembly_id ? "Not mapped" : "Select an assembly"} />
            </Field>
            <Field label="Zone (auto)">
              <ReadOnly loading={f.assembly_id && loc === null} value={loc?.zone_name} empty={f.assembly_id ? "Not mapped" : "Select an assembly"} />
            </Field>
          </Grid>
          <Field label="Influence / Position in Assembly">
            <textarea value={f.influence_position} onChange={(e) => set("influence_position", e.target.value)} className={areaCls} rows={2} placeholder="Position held, scope of influence, remarks" />
          </Field>
        </Section>

        {/* Key activities */}
        <Section title="Key Activities">
          <div className="space-y-2">
            {f.key_activities.map((a, i) => (
              <input key={i} value={a} onChange={(e) => setAct(i, e.target.value)} className={inputCls} placeholder={`Activity ${i + 1}`} />
            ))}
          </div>
        </Section>

        {/* Political journey */}
        <Section title="Political Journey">
          <textarea value={f.political_journey} onChange={(e) => set("political_journey", e.target.value)} className={areaCls} rows={4} placeholder="Describe the political journey, associations, milestones…" />
        </Section>

        {/* Previous election */}
        <Section title="Previous Election Experience">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 mb-1">
            <input type="checkbox" checked={f.contested_election} onChange={(e) => set("contested_election", e.target.checked)} className="w-4 h-4" />
            Has contested an election before
          </label>
          {f.contested_election && (
            <Grid>
              <Field label="Election Type"><input value={f.election_type} onChange={(e) => set("election_type", e.target.value)} className={inputCls} placeholder="e.g. Assembly, Panchayat" /></Field>
              <Field label="Year"><input value={f.election_year} onChange={(e) => set("election_year", e.target.value)} className={inputCls} placeholder="e.g. 2018" /></Field>
              <Field label="Constituency"><input value={f.election_constituency} onChange={(e) => set("election_constituency", e.target.value)} className={inputCls} /></Field>
              <Field label="Party"><input value={f.election_party} onChange={(e) => set("election_party", e.target.value)} className={inputCls} /></Field>
              <Field label="Result"><input value={f.election_result} onChange={(e) => set("election_result", e.target.value)} className={inputCls} placeholder="Won / Lost" /></Field>
              <Field label="Votes"><input value={f.election_votes} onChange={(e) => set("election_votes", e.target.value)} className={inputCls} /></Field>
              <Field label="Details" full><textarea value={f.election_details} onChange={(e) => set("election_details", e.target.value)} className={areaCls} rows={2} /></Field>
            </Grid>
          )}
        </Section>

        {/* Org / social */}
        <Section title="Organizational / Social Activity">
          <textarea value={f.org_social_activity} onChange={(e) => set("org_social_activity", e.target.value)} className={areaCls} rows={3} placeholder="Organizations, social work, community roles…" />
        </Section>

        {/* Economic (sensitive) */}
        <Section title="Economic Status / Profile" note="Sensitive — visible to Super Admin only">
          <Grid>
            <Field label="Economic Status">
              <select value={f.economic_status} onChange={(e) => set("economic_status", e.target.value)} className={inputCls}>
                <option value="">Select</option>
                {(meta?.economicStatuses || []).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </Grid>
          <Field label="Economic Profile (remarks)">
            <textarea value={f.economic_profile} onChange={(e) => set("economic_profile", e.target.value)} className={areaCls} rows={2} placeholder="Business, assets, financial standing…" />
          </Field>
        </Section>

        {/* Potential */}
        <Section title="Potential Strength for Party">
          <Grid>
            <Field label="Potential Rating">
              <select value={f.potential_rating} onChange={(e) => set("potential_rating", e.target.value)} className={inputCls}>
                <option value="">Select rating</option>
                {(meta?.potentialRatings || []).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
          </Grid>
          <Field label="Areas of Strength"><textarea value={f.potential_areas} onChange={(e) => set("potential_areas", e.target.value)} className={areaCls} rows={2} /></Field>
          <Field label="Expected Time Contribution"><textarea value={f.expected_contribution} onChange={(e) => set("expected_contribution", e.target.value)} className={areaCls} rows={2} /></Field>
          <Field label="Remarks"><textarea value={f.potential_remarks} onChange={(e) => set("potential_remarks", e.target.value)} className={areaCls} rows={2} /></Field>
        </Section>

        {/* Status & next action */}
        <Section title="Current Status & Next Action">
          <Grid>
            <Field label="Current Status">
              <select value={f.status} onChange={(e) => set("status", e.target.value)} className={inputCls}>
                {(meta?.statuses || ["New"]).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Next Action">
              <select value={f.next_action} onChange={(e) => set("next_action", e.target.value)} className={inputCls}>
                <option value="">Select action</option>
                {(meta?.nextActions || []).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Follow-up Date"><input type="date" value={f.follow_up_date} onChange={(e) => set("follow_up_date", e.target.value)} className={inputCls} /></Field>
            <Field label="Responsible Person"><input value={f.responsible_person} onChange={(e) => set("responsible_person", e.target.value)} className={inputCls} /></Field>
          </Grid>
          <Field label="Action Remarks"><textarea value={f.action_remarks} onChange={(e) => set("action_remarks", e.target.value)} className={areaCls} rows={2} /></Field>
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

// ---------------------------------------------------------------------------
// View modal
// ---------------------------------------------------------------------------
function ViewModal({ row, meta, onClose, onEdit }) {
  const acts = Array.isArray(row.key_activities) ? row.key_activities : [];
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
            {row.potential_rating && <span className="px-2 py-0.5 rounded-full text-xs font-medium border bg-indigo-50 text-indigo-700 border-indigo-200">Potential: {ratingLabel(meta, row.potential_rating)}</span>}
            {row.next_action && <span className="px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-100 text-gray-600 border-gray-200">Next: {row.next_action}</span>}
          </div>

          {/* Location (auto-resolved from Assembly) */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <ViewInline label="Assembly" value={row.assembly_name} />
            <ViewInline label="District" value={row.district_name} />
            <ViewInline label="Lok Sabha" value={row.lok_sabha_name} />
            <ViewInline label="Zone" value={row.zone_name} />
          </div>
          <ViewBlock label="Address" value={row.address} />
          <ViewBlock label="Influence / Position in Assembly" value={row.influence_position} />

          {acts.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Key Activities</div>
              <ul className="list-disc pl-5 space-y-0.5 text-gray-700">{acts.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}

          <ViewBlock label="Political Journey" value={row.political_journey} />

          {row.contested_election ? (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Previous Election Experience</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-700">
                <ViewInline label="Type" value={row.election_type} />
                <ViewInline label="Year" value={row.election_year} />
                <ViewInline label="Constituency" value={row.election_constituency} />
                <ViewInline label="Party" value={row.election_party} />
                <ViewInline label="Result" value={row.election_result} />
                <ViewInline label="Votes" value={row.election_votes} />
              </div>
              {row.election_details && <p className="text-gray-700 mt-1">{row.election_details}</p>}
            </div>
          ) : (
            <ViewBlock label="Previous Election Experience" value="No" />
          )}

          <ViewBlock label="Organizational / Social Activity" value={row.org_social_activity} />
          <ViewBlock label="Economic Status" value={row.economic_status} />
          <ViewBlock label="Economic Profile" value={row.economic_profile} />
          <ViewBlock label="Areas of Strength" value={row.potential_areas} />
          <ViewBlock label="Expected Time Contribution" value={row.expected_contribution} />
          <ViewBlock label="Potential Remarks" value={row.potential_remarks} />
          <ViewBlock label="Action Remarks" value={row.action_remarks} />
          <div className="grid grid-cols-2 gap-x-4">
            <ViewInline label="Follow-up Date" value={row.follow_up_date ? String(row.follow_up_date).slice(0, 10) : ""} />
            <ViewInline label="Responsible Person" value={row.responsible_person} />
          </div>
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
