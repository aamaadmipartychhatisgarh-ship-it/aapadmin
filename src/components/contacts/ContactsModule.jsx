"use client";

import { useEffect, useState, useRef } from "react";
import { Upload, Plus, Search, Loader2, CheckCircle2, Trash2, ClipboardList, UserCheck, UserPlus, UserMinus, MapPin, Download, X, FileSpreadsheet, FileText, AlertTriangle, Camera, Network } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import DesignationMultiSelect, { parseDesignationIdList } from "@/components/contacts/DesignationMultiSelect";
import ActionBar from "@/components/ActionBar";
import CollapsibleSection from "@/components/CollapsibleSection";
import FilterMultiSelect from "@/components/FilterMultiSelect";
import PersonDetailModal from "@/components/PersonDetailModal";
import { isCaller, isSuperAdmin, normalizeRole, ROLES } from "@/lib/permissions";
import CallActionIcons from "@/components/CallActionIcons";
import Avatar from "@/components/Avatar";
import ProfilePhoto from "@/components/ProfilePhoto";

const PAGE_SIZE = 50; // contacts per page — keeps each query light on big tables

// ONE Contacts module, rendered by both /dashboard/admin/contacts and
// /dashboard/supervisor/contacts (each a thin auth-gate wrapper around this
// component — see those two page.js files). Same UI, same layout, same
// workflow either way; this config table is the ONLY place behavior
// branches by role, and every branch is either an API endpoint (so the
// server does the actual territory scoping) or an admin-only convenience
// that was never part of a Supervisor's granted permissions (Add Contact,
// Excel/CSV import, bulk-delete Wrong Numbers, editing a contact's
// geography — see the PUT /api/supervisor/contacts/[id] comment for why
// geo-editing specifically stays admin-only: it's a server-enforced
// restriction, not a UI choice).
const MODES = {
  admin: {
    listUrl: "/api/contacts",
    idsUrl: "/api/contacts/ids",
    bulkDistributeUrl: "/api/contacts/bulk-distribute",
    bulkUnassignUrl: "/api/contacts/bulk-unassign",
    contactUrl: (id) => `/api/contacts/${id}`,
    photoUrl: (id) => `/api/contacts/${id}/photo`,
    callersUrl: "/api/users",
    callersNeedRoleFilter: true, // /api/users returns every user; filter to callers client-side
    teamsUrl: "/api/teams",
    teamMembersUrl: (teamId) => `/api/teams/${teamId}`,
    teamMemberType: "user", // admin's team-member rows carry both user- and worker-type members
    importExcelUrl: "/api/contacts/import-excel",
    uploadCsvUrl: "/api/contacts/upload-csv",
    bulkDeleteWrongUrl: "/api/contacts/bulk-delete",
    addContactUrl: "/api/contacts",
    canAdd: true, canImport: true, canDeleteWrong: true, canEditGeo: true,
    territoryScoped: false,
    breadcrumbTrail: [{ label: "Dashboard", href: "/dashboard/admin" }, { label: "People" }, { label: "Contacts" }],
  },
  supervisor: {
    listUrl: "/api/supervisor/contacts",
    idsUrl: "/api/supervisor/contacts/ids",
    bulkDistributeUrl: "/api/supervisor/contacts/bulk-distribute",
    bulkUnassignUrl: "/api/supervisor/contacts/bulk-unassign",
    contactUrl: (id) => `/api/supervisor/contacts/${id}`,
    photoUrl: (id) => `/api/supervisor/contacts/${id}/photo`,
    callersUrl: "/api/supervisor/contacts/callers",
    callersNeedRoleFilter: false, // already role- and territory-filtered server-side
    teamsUrl: "/api/supervisor/contacts/teams",
    teamMembersUrl: (teamId) => `/api/supervisor/contacts/teams/${teamId}`,
    teamMemberType: null, // this endpoint only ever returns caller-type members
    scopeUrl: "/api/supervisor/contacts/scope",
    addContactUrl: "/api/supervisor/contacts",
    // CSV Import / Upload reuse the shared contacts endpoints (now open to
    // oversight roles) so the 3-dot menu is identical in both dashboards.
    importExcelUrl: "/api/contacts/import-excel",
    uploadCsvUrl: "/api/contacts/upload-csv",
    // Add Contact is enabled — the server stamps the new contact's geography
    // from the supervisor's own territory (see POST /api/supervisor/contacts).
    // bulk-delete-wrong stays admin-only, and geo-editing an existing contact
    // stays server-restricted (see the PUT /api/supervisor/contacts/[id] comment).
    canAdd: true, canImport: true, canDeleteWrong: false, canEditGeo: false,
    territoryScoped: true,
    breadcrumbTrail: [{ label: "Dashboard", href: "/dashboard/supervisor" }, { label: "Contacts" }],
  },
};

export default function ContactsModule({ session, mode }) {
  const cfg = MODES[mode];
  const [scopeLoading, setScopeLoading] = useState(cfg.territoryScoped);
  const [hasScope, setHasScope] = useState(!cfg.territoryScoped);
  const [territory, setTerritory] = useState(null); // { level, zone, lok_sabha, district, assembly } — supervisor mode only

  const [contacts, setContacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState([]); // callers
  const [zones, setZones] = useState([]);
  const [zoneId, setZoneId] = useState("");
  const [lokSabhas, setLokSabhas] = useState([]);
  const [lokSabhaId, setLokSabhaId] = useState("");
  const [districts, setDistricts] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [designationIds, setDesignationIds] = useState([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  // Initialise from a ?filter= deep-link (e.g. sidebar "Wrong Numbers") on the
  // very first render, so every load uses the right filter and none race in as
  // the default. This component only mounts client-side, so reading the URL
  // here is safe.
  const [filter, setFilter] = useState(() => {
    if (typeof window !== "undefined") {
      const f = new URLSearchParams(window.location.search).get("filter");
      if (f && ["all", "pending", "done", "assigned", "pool", "duplicates", "wrong"].includes(f)) return f;
    }
    return "pending";
  }); // all | pending | done | assigned | pool | duplicates | wrong
  const [districtId, setDistrictId] = useState("");
  const [assemblies, setAssemblies] = useState([]);
  const [assemblyIds, setAssemblyIds] = useState([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null); // index into `contacts`, or null
  const [editNavBusy, setEditNavBusy] = useState(false); // fetching an adjacent page mid-edit
  const [taskFor, setTaskFor] = useState(null); // contact to create a task for
  const [viewingContact, setViewingContact] = useState(null); // contact row to show in the detail modal, or null
  const [showImport, setShowImport] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bulkCallers, setBulkCallers] = useState([]); // selected caller ids
  const [teams, setTeams] = useState([]);
  const [bulkTeam, setBulkTeam] = useState("");
  const [bulkMode, setBulkMode] = useState("even"); // even | perCaller
  const [perCaller, setPerCaller] = useState(100);
  // §8: default OFF — pooling preserves existing assignments and only hands out
  // unassigned pool contacts. Ticking it is an explicit opt-in to pull matching
  // contacts off other callers.
  const [reassignOthers, setReassignOthers] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Filter-independent status breakdown for the Assignment Summary — always
  // shows the full picture (Pending/Assigned/Pool/Done) regardless of which
  // status pill is currently active, scoped by the same geo/designation filters.
  const [counts, setCounts] = useState({ pending: 0, assigned: 0, pool: 0, done: 0, address: 0, photo: 0 });
  const [countsLoading, setCountsLoading] = useState(true);
  // Bulk checkbox selection — an explicit set of contact ids. Empty means
  // "act on everything matching the current filters" (the original,
  // unchanged behavior); non-empty means "act on exactly these contacts".
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [selectingAll, setSelectingAll] = useState(false);
  const fileRef = useRef(null);
  const loadSeq = useRef(0);
  const countSeq = useRef(0);

  // Resolve the supervisor's own territory once (supervisor mode only), then
  // seed the geo filters to it (locking the levels at/above the anchor — see
  // the JSX below).
  useEffect(() => {
    if (!cfg.territoryScoped) return;
    fetch(cfg.scopeUrl).then((r) => r.json()).then((d) => {
      setHasScope(!!d.has_scope);
      setTerritory(d.territory || null);
      if (d.territory) {
        if (d.territory.zone) setZoneId(String(d.territory.zone.id));
        if (d.territory.lok_sabha) setLokSabhaId(String(d.territory.lok_sabha.id));
        if (d.territory.district) setDistrictId(String(d.territory.district.id));
        if (d.territory.assembly) setAssemblyIds([d.territory.assembly.id]);
      }
      setScopeLoading(false);
    }).catch(() => setScopeLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload the page of results whenever a filter or the page number changes.
  useEffect(() => { if (!scopeLoading) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scopeLoading, filter, zoneId, lokSabhaId, districtId, assemblyIds, designationIds, assignedTo, page]);
  // Any filter change (not a page change) jumps back to page 1 and drops any
  // bulk selection — a selection made under one filter view shouldn't silently
  // carry over and get acted on under a different one.
  useEffect(() => { setPage(1); setSelectedIds(new Set()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter, zoneId, lokSabhaId, districtId, assemblyIds, designationIds, assignedTo, search]);

  useEffect(() => {
    fetch(cfg.callersUrl).then((r) => r.json()).then((d) => {
      const list = d.users || [];
      setUsers(cfg.callersNeedRoleFilter ? list.filter((u) => normalizeRole(u.role) === ROLES.CALLER) : list);
    });
    // Zone options: admin always, and supervisor too. A configured supervisor's
    // zone dropdown stays locked to their own zone (see the JSX), so loading the
    // full list is harmless there; an UNCONFIGURED (full-oversight) supervisor
    // has no locked zone, so the dropdown must offer every zone — same list the
    // Super Admin Contacts page uses (reuses the identical /api/locations loader).
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || []));
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || []));
    fetch(cfg.teamsUrl).then((r) => r.json()).then((d) => setTeams(d.teams || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Assignment Summary counts — independent of the active status pill.
  useEffect(() => { if (!scopeLoading) loadCounts(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [scopeLoading, zoneId, lokSabhaId, districtId, assemblyIds, designationIds, assignedTo]);
  async function loadCounts() {
    const seq = ++countSeq.current;
    setCountsLoading(true);
    const base = new URLSearchParams();
    if (zoneId) base.set("zone_id", zoneId);
    if (lokSabhaId) base.set("lok_sabha_id", lokSabhaId);
    if (districtId) base.set("district_id", districtId);
    if (assemblyIds.length) base.set("assembly_ids", assemblyIds.join(","));
    if (designationIds.length) base.set("designation_ids", designationIds.join(","));
    // Caller-wise counts too (§8): the status counts must reflect the SAME
    // caller + designation scope the list uses, so the badge count can never
    // differ from the actual filtered/pooled records.
    if (assignedTo) base.set("assigned_to", assignedTo);
    base.set("page_size", "1");
    const fetchCount = async (status) => {
      const p = new URLSearchParams(base);
      p.set("status", status);
      const r = await fetch(`${cfg.listUrl}?${p}`, { cache: "no-store" });
      return r.ok ? (await r.json()).total ?? 0 : 0;
    };
    // Address / Photo counts (PROMPT 2) — across the SAME scope, independent of
    // the status pill: total contacts that have a real address / a stored photo.
    const fetchFlag = async (flag) => {
      const p = new URLSearchParams(base);
      p.set(flag, "1");
      const r = await fetch(`${cfg.listUrl}?${p}`, { cache: "no-store" });
      return r.ok ? (await r.json()).total ?? 0 : 0;
    };
    const [pending, assigned, pool, done, address, photo] = await Promise.all([
      fetchCount("pending"), fetchCount("assigned"), fetchCount("pool"), fetchCount("done"),
      fetchFlag("has_address"), fetchFlag("has_photo"),
    ]);
    if (seq !== countSeq.current) return;
    setCounts({ pending, assigned, pool, done, address, photo });
    setCountsLoading(false);
  }

  // Selecting a team pre-selects all its caller members for distribution.
  async function loadTeamCallers(teamId) {
    setBulkTeam(teamId);
    if (!teamId) return;
    const r = await fetch(cfg.teamMembersUrl(teamId));
    if (!r.ok) return;
    const d = await r.json();
    const callerIds = users.map((u) => u.id);
    const memberCallerIds = (d.members || [])
      .filter((m) => (cfg.teamMemberType ? m.member_type === cfg.teamMemberType : true) && callerIds.includes(m.user_id))
      .map((m) => m.user_id);
    setBulkCallers(memberCallerIds);
    if (memberCallerIds.length === 0) {
      setError(cfg.territoryScoped ? "This team has no caller accounts in your territory." : "This team has no caller accounts as members. Add users to the team first.");
    } else setError("");
  }

  function toggleBulkCaller(id) {
    setBulkCallers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  // Bulk checkbox selection — individual toggle, toggle the whole loaded
  // page, fetch+select every id matching the current filters (across every
  // page), or clear.
  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const pageIds = contacts.map((c) => c.id);
  const pageFullySelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  function toggleSelectPage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (pageFullySelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }
  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      const r = await fetch(`${cfg.idsUrl}?${buildParams(1)}`);
      const d = await r.json();
      setSelectedIds(new Set(d.ids || []));
    } catch {
      setError("Couldn't select all — network error.");
    } finally {
      setSelectingAll(false);
    }
  }
  function clearSelection() { setSelectedIds(new Set()); }

  // Distribute contacts across the selected callers (even split or N each) —
  // either exactly the checked contacts (if any are selected), or everything
  // matching the current filters (the original, unchanged default).
  async function bulkDistribute() {
    setMessage(""); setError("");
    if (bulkCallers.length === 0) { setError("Select at least one caller to distribute to."); return; }
    const names = bulkCallers.map((id) => users.find((u) => u.id === id)?.username).filter(Boolean).join(", ");
    const desc = bulkMode === "perCaller"
      ? `${perCaller} contacts each to ${bulkCallers.length} caller(s): ${names}`
      : `evenly across ${bulkCallers.length} caller(s): ${names}`;
    const hasSelection = selectedIds.size > 0;
    const desigNames = designations.filter((d) => designationIds.includes(d.id)).map((d) => d.name);
    const desigLabel = desigNames.length ? ` with designation ${desigNames.map((n) => `"${n}"`).join(", ")}` : "";
    const skipNote = !hasSelection && filter === "pending" ? " (Already-called contacts are excluded — you're viewing Pending only.)" : "";
    const targetDesc = hasSelection
      ? `${selectedIds.size} selected contact${selectedIds.size === 1 ? "" : "s"}`
      : `${filter !== "all" ? filter + " " : ""}contacts${cfg.territoryScoped ? " in your territory" : (districtId ? " in this district" : "")}${desigLabel}`;
    if (!confirm(`Distribute ${targetDesc} — ${desc}?${skipNote}`)) return;
    setBulkBusy(true);
    try {
      const r = await fetch(cfg.bulkDistributeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caller_ids: bulkCallers,
          mode: bulkMode,
          per_caller: bulkMode === "perCaller" ? Number(perCaller) : undefined,
          reassign: reassignOthers,
          ...(hasSelection ? { contact_ids: [...selectedIds] } : {
            status: filter,
            // Send EVERY active list filter so distribution acts on exactly the
            // same people the filtered list shows.
            zone_id: zoneId || undefined,
            lok_sabha_id: lokSabhaId || undefined,
            district_id: districtId || undefined,
            assembly_ids: assemblyIds.length ? assemblyIds.join(",") : undefined,
            designation_ids: designationIds.length ? designationIds.join(",") : undefined,
            search: search || undefined,
          }),
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.message || "Distribute failed"); return; }
      const breakdown = Object.entries(d.per_caller_counts || {}).map(([u, n]) => `${u}: ${n}`).join(", ");
      // A matched/assigned gap only ever has one legitimate cause: "N per
      // caller" × callers capping the batch below the full match. In "even"
      // mode there's no cap at all, so matched should always equal assigned —
      // if it doesn't there, that's a real failure, not a capacity note.
      const capNote = bulkMode === "perCaller" && d.matched_total > d.assigned
        ? ` (${d.matched_total} contacts matched${hasSelection ? " your selection" : " your filters"}; ${d.matched_total - d.assigned} weren't included because "N per caller" × callers is smaller than the match — raise the per-caller count or add callers to cover them all.)`
        : "";
      const failed = d.failed > 0 ? ` ⚠ ${d.failed} failed to save — check the server log.` : "";
      setMessage(`✓ Distributed ${d.assigned} of ${d.matched_total} ${hasSelection ? "selected" : "matching"} contacts — ${breakdown || "none matched"}.${capNote}${failed}`);
      clearSelection();
      load();
      loadCounts();
    } catch {
      setError("Distribute failed — network error.");
    } finally {
      setBulkBusy(false);
    }
  }

  // Recall contacts from callers' workspaces — back to the pool, nothing deleted.
  // Respects the SAME scope the list shows: an explicit checkbox selection recalls
  // exactly those contacts; otherwise the active caller + designation + geo +
  // status + search filters decide, so recalling "designation X" removes ONLY the
  // matching contacts, never the caller's whole assignment (BUG #10).
  async function bulkRecall() {
    setMessage(""); setError("");
    const hasSelection = selectedIds.size > 0;
    const desigNames = designations.filter((d) => designationIds.includes(d.id)).map((d) => d.name);
    const desigLabel = desigNames.length ? ` with designation ${desigNames.map((n) => `"${n}"`).join(", ")}` : "";
    const callerLabel = bulkCallers.length > 0
      ? `${bulkCallers.length} selected caller(s)`
      : (assignedTo ? "the selected caller" : (cfg.territoryScoped ? "callers in your territory" : "callers"));
    const scope = hasSelection
      ? `${selectedIds.size} selected contact(s)`
      : `${filter !== "all" ? filter + " " : ""}contacts${desigLabel} from ${callerLabel}`;
    if (!confirm(`Return ${scope} to the pool? Only these contacts are affected — every other designation and caller stays assigned. Contacts stay in the database; completed calls are not touched.`)) return;
    setBulkBusy(true);
    try {
      const r = await fetch(cfg.bulkUnassignUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caller_ids: bulkCallers,
          ...(hasSelection ? { contact_ids: [...selectedIds] } : {
            assigned_to: assignedTo || undefined,
            status: filter,
            zone_id: zoneId || undefined,
            lok_sabha_id: lokSabhaId || undefined,
            district_id: districtId || undefined,
            assembly_ids: assemblyIds.length ? assemblyIds.join(",") : undefined,
            designation_ids: designationIds.length ? designationIds.join(",") : undefined,
            search: search || undefined,
          }),
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.message || "Recall failed"); return; }
      setMessage(`Returned ${d.unassigned} contact(s) to the pool. Other assignments are unchanged.`);
      setSelectedIds(new Set());
      load();
      loadCounts();
    } catch {
      setError("Recall failed — network error.");
    } finally {
      setBulkBusy(false);
    }
  }

  // Cascading location filters. In supervisor mode, dropdowns AT/ABOVE the
  // territory anchor are locked and this cascade skips them entirely; below
  // the anchor (and always, in admin mode) it behaves identically — Lok
  // Sabha follows Zone, selecting a Lok Sabha shows ALL of its Vidhan Sabhas
  // (assemblies) directly, District is an optional narrower filter.
  useEffect(() => {
    // Locked only when a CONFIGURED supervisor sits below the zone level. An
    // unconfigured supervisor (territory === null) cascades freely, like admin.
    if (cfg.territoryScoped && territory && territory.level !== "zone") return;
    const url = zoneId ? `/api/locations?parent_id=${zoneId}` : "/api/locations?type=lok_sabha";
    fetch(url).then((r) => r.json()).then((d) => setLokSabhas((d.locations || []).filter((l) => l.type === "lok_sabha")));
    if (!cfg.territoryScoped) { setLokSabhaId(""); setDistrictId(""); setAssemblyIds([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId, territory]);
  useEffect(() => {
    // Skip only for a CONFIGURED supervisor whose anchor locks the district
    // (district/assembly level). Zone-level and unconfigured both cascade.
    if (cfg.territoryScoped && territory) {
      if (territory.level !== "zone" && territory.level !== "district") return;
      if (territory.level === "district") return; // district is the fixed anchor, no cascade needed
    }
    const url = lokSabhaId ? `/api/locations?parent_id=${lokSabhaId}` : "/api/locations?type=district";
    fetch(url).then((r) => r.json()).then((d) => setDistricts((d.locations || []).filter((l) => l.type === "district")));
    if (!cfg.territoryScoped) setDistrictId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lokSabhaId, territory]);

  // Assembly (Vidhan Sabha) options: if a district is picked, narrow to it;
  // otherwise if a Lok Sabha is picked, show ALL of its assemblies directly.
  useEffect(() => {
    // Locked only for a CONFIGURED assembly-level supervisor; unconfigured cascades.
    if (cfg.territoryScoped && territory && territory.level === "assembly") return; // already at the finest grain
    let url = null;
    if (districtId) url = `/api/locations?parent_id=${districtId}`;
    else if (lokSabhaId) url = `/api/locations?assemblies_of_lok_sabha=${lokSabhaId}`;
    if (url) {
      fetch(url).then((r) => r.json()).then((d) => setAssemblies((d.locations || []).filter((l) => l.type === "assembly")));
    } else setAssemblies([]);
    setAssemblyIds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [districtId, lokSabhaId, territory]);

  // Shared by the main table load AND the Edit modal's "jump to the next/prev
  // page's first/last contact" boundary crossing — both must query the exact
  // same filtered set so the sequence paged through stays consistent.
  function buildParams(pageNum) {
    const params = new URLSearchParams();
    if (filter === "duplicates") params.set("duplicates", "1");
    else if (filter === "wrong") params.set("wrong", "1");
    else if (filter !== "all") params.set("status", filter);
    if (search) params.set("search", search);
    if (zoneId) params.set("zone_id", zoneId);
    if (lokSabhaId) params.set("lok_sabha_id", lokSabhaId);
    if (districtId) params.set("district_id", districtId);
    if (assemblyIds.length) params.set("assembly_ids", assemblyIds.join(","));
    if (designationIds.length) params.set("designation_ids", designationIds.join(","));
    if (assignedTo) params.set("assigned_to", assignedTo);
    params.set("page", String(pageNum));
    params.set("page_size", String(PAGE_SIZE));
    return params;
  }

  // Export contacts to Excel / PDF / CSV. Priority (same on server): (1) if any
  // contacts are checkbox-SELECTED, export exactly those; else (2) the CURRENT
  // filters (search, geo, designation, caller, status); else (3) everything. The
  // server reuses the same filter + role scope as the on-screen list, so what
  // downloads is what's shown (and, for a supervisor, only their territory).
  const [exportingFormat, setExportingFormat] = useState(""); // which format is in flight
  async function exportData(format) {
    setExporting(true); setExportingFormat(format); setError(""); setMessage("");
    // Abort so the menu can never hang if the server stalls building a big PDF.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const params = buildParams(1);
      params.delete("page"); params.delete("page_size");
      params.set("format", format);
      // Priority 1 — an explicit checkbox selection overrides the filters.
      if (selectedIds.size > 0) params.set("ids", [...selectedIds].join(","));
      const r = await fetch(`${cfg.listUrl}?${params}`, { cache: "no-store", signal: controller.signal });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.message || "Export failed. Please try again.");
        return;
      }
      const cd = r.headers.get("content-disposition") || "";
      const m = cd.match(/filename="?([^"]+)"?/i);
      const ext = format === "xlsx" ? "xlsx" : format;
      const filename = m ? m[1] : `Contacts_Export_${new Date().toISOString().slice(0, 10)}.${ext}`;
      const blob = await r.blob();
      if (!blob || blob.size === 0) { setError("The export came back empty. Please adjust the selection and try again."); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      const scopeNote = selectedIds.size > 0 ? `${selectedIds.size} selected` : "current filters";
      setMessage(`${format === "pdf" ? "PDF" : format === "xlsx" ? "Excel" : "CSV"} export ready (${scopeNote}) — downloading “${filename}”.`);
    } catch (e) {
      setError(e.name === "AbortError" ? "Export timed out — narrow the selection and try again." : "Export failed — network error.");
    } finally {
      clearTimeout(timer);
      setExporting(false); setExportingFormat("");
    }
  }

  async function fetchContactsPage(pageNum) {
    const r = await fetch(`${cfg.listUrl}?${buildParams(pageNum)}`, { cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    return { contacts: d.contacts || [], total: d.total ?? (d.contacts || []).length };
  }

  async function load() {
    // Several effects (filter change, URL deep-link, search debounce) can fire
    // loads near-simultaneously. Tag each request and only let the latest one
    // apply, so a slower earlier response can't clobber the current filter.
    const seq = ++loadSeq.current;
    setLoading(true);
    const d = await fetchContactsPage(page);
    if (seq !== loadSeq.current) return; // a newer load started — drop this stale result
    if (d) { setContacts(d.contacts); setTotal(d.total); }
    setLoading(false);
  }

  // Edit-and-advance navigation: move to the next/previous contact in the
  // SAME filtered order the table shows, crossing a page boundary (fetching
  // that page) when the current one runs out — never have to close the
  // modal, refind their place, and reopen the next row by hand.
  async function editStep(delta) {
    if (editingIndex == null) return;
    const nextInPage = editingIndex + delta;
    if (nextInPage >= 0 && nextInPage < contacts.length) { setEditingIndex(nextInPage); return; }
    const targetPage = page + delta;
    if (targetPage < 1 || (delta > 0 && (targetPage - 1) * PAGE_SIZE >= total)) return; // nothing further
    setEditNavBusy(true);
    const d = await fetchContactsPage(targetPage);
    setEditNavBusy(false);
    if (!d || d.contacts.length === 0) return;
    setContacts(d.contacts);
    setTotal(d.total);
    setPage(targetPage);
    setEditingIndex(delta > 0 ? 0 : d.contacts.length - 1);
  }

  const editingContact = editingIndex != null ? contacts[editingIndex] : null;
  const editingPosition = editingIndex != null ? (page - 1) * PAGE_SIZE + editingIndex + 1 : null;
  const editingHasPrev = editingIndex != null && ((editingIndex > 0) || page > 1);
  const editingHasNext = editingIndex != null && ((editingIndex < contacts.length - 1) || page * PAGE_SIZE < total);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Upload CSV: inserts new contacts and SKIPS duplicates (unique phone), so it
  // never creates duplicate contacts. Reports processed vs. failed counts.
  async function uploadCsv(file) {
    setMessage(""); setError("");
    setUploading(true);
    try {
      const text = await file.text();
      const r = await fetch(cfg.uploadCsvUrl, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: text,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data.message || "Upload failed. Check the CSV columns and try again."); return; }
      const failed = Array.isArray(data.errors) ? data.errors.length : 0;
      let msg = `Upload complete: ${data.inserted} added, ${data.duplicates} duplicate${data.duplicates === 1 ? "" : "s"} skipped`;
      if (failed) msg += `, ${failed} failed`;
      msg += ` (of ${data.total_rows} rows).`;
      setMessage(msg);
      load();
    } catch {
      setError("Upload failed — network error.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Import Excel/CSV is handled by the self-contained <ImportModal> (opened from
  // the ⋮ menu). It POSTs to cfg.importExcelUrl, shows filename/size/progress and
  // the imported/updated/skipped/failed result, then refreshes the list here.

  // Delete every wrong-number contact in the current view (optionally scoped to
  // the selected district). The endpoint only ever targets wrong numbers.
  async function bulkDeleteWrong() {
    setMessage(""); setError("");
    if (total === 0) return;
    if (!confirm(`Delete all ${total} wrong-number contact(s)${districtId ? " in this district" : ""}? Their call history is kept, but the contacts are removed from the calling list. This cannot be undone.`)) return;
    try {
      const r = await fetch(cfg.bulkDeleteWrongUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ district_id: districtId || undefined }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.message || "Delete failed"); return; }
      setMessage(`Deleted ${d.deleted} wrong-number contact(s).`);
      load();
    } catch {
      setError("Delete failed — network error.");
    }
  }

  async function removeContact(c) {
    if (!confirm(`Delete contact "${c.person_name}" (${c.phone_number})? Their call history stays, but the contact is removed from the calling list.`)) return;
    const r = await fetch(cfg.contactUrl(c.id), { method: "DELETE" });
    if (r.ok) { setMessage(`Deleted ${c.person_name}.`); load(); loadCounts(); }
    else { const d = await r.json().catch(() => ({})); setError(d.message || "Delete failed"); }
  }

  async function assign(contactId, userId) {
    const r = await fetch(cfg.contactUrl(contactId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigned_to_user_id: userId || null }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.message || "Assign failed"); }
    load();
  }

  if (scopeLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  // A Supervisor with no configured territory used to get a full-page warning
  // here. Instead, always render the full Contacts module — the server scopes
  // their data strictly (an unscoped account simply sees an empty table via the
  // normal empty state, never everyone else's contacts).

  const territoryLabel = territory ? [territory.zone?.name, territory.lok_sabha?.name, territory.district?.name, territory.assembly?.name].filter(Boolean).join(" → ") : "";

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        icon={UserCheck}
        title="Contacts"
        description={
          cfg.territoryScoped ? (
            <>
              <span className="font-bold text-[#164FA3]">{total.toLocaleString()}</span>{" "}
              {filter === "duplicates" ? "possible duplicate" : filter === "wrong" ? "wrong-number" : filter !== "all" ? filter : ""} contact{total === 1 ? "" : "s"} in your territory.
            </>
          ) : (
            <>
              <span className="font-bold text-[#164FA3]">{total.toLocaleString()}</span>{" "}
              {filter === "duplicates" ? "possible duplicate" : filter === "wrong" ? "wrong-number" : filter !== "all" ? filter : ""} contact{total === 1 ? "" : "s"}{districtId ? " in this district" : ""}.
              {filter === "duplicates" ? " Same phone number saved in different formats — review and delete the extras."
                : filter === "wrong" ? " Latest call outcome was “Wrong Number” — review and delete them from the calling list."
                : " Calling list for the team."}
            </>
          )
        }
        breadcrumb={cfg.breadcrumbTrail}
        actions={
          // One shared 3-dot (⋮) menu — identical in the admin and supervisor
          // dashboards — holding exactly Import CSV / Export CSV / Upload CSV.
          // Add Contact stays its own primary button, immediately to the right
          // of the ⋮ (ActionBar renders the menu first, then the primary).
          <ActionBar items={[
            { key: "hierarchy", label: "Designation Hierarchy", icon: Network, menuOnly: true, onClick: () => { window.location.href = "/dashboard/admin/contacts-hierarchy"; } },
            cfg.canImport && { key: "import", label: "Import Excel", icon: Upload, menuOnly: true, onClick: () => setShowImport(true) },
            // Export — Excel / PDF / CSV. The label reflects the priority: when
            // contacts are checkbox-selected it exports ONLY those, otherwise the
            // current filters (or everything when unfiltered).
            { key: "export-xlsx", label: (exporting && exportingFormat === "xlsx") ? "Exporting…" : `Export Excel${selectedIds.size > 0 ? ` (${selectedIds.size} selected)` : ""}`, icon: FileSpreadsheet, loading: exporting && exportingFormat === "xlsx", disabled: exporting, menuOnly: true, onClick: () => exportData("xlsx") },
            { key: "export-pdf", label: (exporting && exportingFormat === "pdf") ? "Exporting…" : `Export PDF${selectedIds.size > 0 ? ` (${selectedIds.size} selected)` : ""}`, icon: FileText, loading: exporting && exportingFormat === "pdf", disabled: exporting, menuOnly: true, onClick: () => exportData("pdf") },
            { key: "export-csv", label: (exporting && exportingFormat === "csv") ? "Exporting…" : "Export CSV", icon: Download, loading: exporting && exportingFormat === "csv", disabled: exporting, menuOnly: true, onClick: () => exportData("csv") },
            cfg.canImport && { key: "upload", label: uploading ? "Uploading…" : "Upload", icon: Upload, loading: uploading, menuOnly: true, onClick: () => fileRef.current?.click() },
            cfg.canAdd && { key: "add", label: "Add Contact", icon: Plus, variant: "primary", onClick: () => setShowAdd(true) },
          ]} />
        }
      />
      {cfg.canImport && (
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
               onChange={(e) => e.target.files?.[0] && uploadCsv(e.target.files[0])} />
      )}
      {showImport && (
        <ImportModal
          url={cfg.importExcelUrl}
          onClose={() => setShowImport(false)}
          onImported={() => load()}
        />
      )}

      {cfg.territoryScoped && territoryLabel && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-[#164FA3] font-medium">
          <MapPin size={16} /> Your territory: {territoryLabel}
        </div>
      )}

      {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 flex items-center gap-2"><CheckCircle2 size={16} />{message}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3">{error}</div>}

      {/* Top count cards (PROMPT 2) — live from the DB for the current scope.
          Address Count = contacts with a real address; Photo Update Count =
          contacts that have a stored photo. Both update on the same reload as
          the rest (add / edit address / upload / remove photo). */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Total Contacts", value: total, Icon: UserCheck, tint: "text-[#164FA3]", live: false },
          { label: "Address Count", value: counts.address, Icon: MapPin, tint: "text-emerald-600", live: true },
          { label: "Photo Update Count", value: counts.photo, Icon: Camera, tint: "text-amber-600", live: true },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-gray-200 shadow-sm px-4 py-3 flex items-center gap-3">
            <span className={`w-9 h-9 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center ${s.tint}`}><s.Icon size={18} /></span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{s.label}</div>
              <div className="text-xl font-bold text-gray-900">{s.live && countsLoading ? "…" : Number(s.value || 0).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>

      <CollapsibleSection title="Search & Filters">
      <div className="flex items-center gap-3 flex-wrap">
        <Search size={18} className="text-gray-400 ml-2" />
        <input type="text" placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 min-w-[180px] outline-none text-sm py-2" />
        <select value={zoneId} disabled={cfg.territoryScoped && !!territory?.zone} onChange={(e) => setZoneId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-500">
          {cfg.territoryScoped && territory?.zone ? (
            <option value={territory.zone.id}>{territory.zone.name}</option>
          ) : (
            <>
              <option value="">All zones</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </>
          )}
        </select>
        <select value={lokSabhaId} disabled={cfg.territoryScoped && territory && territory.level !== "zone"} onChange={(e) => setLokSabhaId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-500">
          {!cfg.territoryScoped || !territory || territory.level === "zone" ? (
            <>
              <option value="">All Lok Sabhas</option>
              {lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </>
          ) : territory?.lok_sabha ? <option value={territory.lok_sabha.id}>{territory.lok_sabha.name}</option> : <option value="">—</option>}
        </select>
        <select value={districtId} disabled={cfg.territoryScoped && territory && territory.level !== "zone"} onChange={(e) => setDistrictId(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-500">
          {!cfg.territoryScoped || !territory || territory.level === "zone" ? (
            <>
              <option value="">All districts</option>
              {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </>
          ) : territory?.district ? <option value={territory.district.id}>{territory.district.name}</option> : <option value="">—</option>}
        </select>
        {cfg.territoryScoped && territory?.level === "assembly" ? (
          <select disabled className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-gray-50 text-gray-500">
            <option>{territory.assembly.name}</option>
          </select>
        ) : (
          <FilterMultiSelect
            label="assemblies" items={assemblies} selected={assemblyIds} onChange={setAssemblyIds}
            disabled={!districtId && !lokSabhaId} disabledLabel={cfg.territoryScoped && territory ? "Pick district" : "Pick Lok Sabha"}
          />
        )}
        <FilterMultiSelect
          label="designations" items={designations} selected={designationIds} onChange={setDesignationIds}
        />
        <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
          <option value="">Any caller</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
        </select>
        <div className="flex gap-1 flex-wrap">
          {["all", "pending", "done", "assigned", "pool", "duplicates", "wrong"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase ${filter === f ? (f === "duplicates" ? "bg-amber-500 text-white" : f === "wrong" ? "bg-red-600 text-white" : "bg-[#164FA3] text-white") : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>{f === "wrong" ? "Wrong #" : f}</button>
          ))}
        </div>
      </div>
      </CollapsibleSection>

      {/* Distribute Contacts Across Callers — hidden in duplicates/wrong views,
          those aren't assignable scopes. */}
      {filter !== "duplicates" && filter !== "wrong" && (
      <CollapsibleSection
        title="Distribute Contacts Across Callers"
        defaultExpanded={false}
        storageKey={`contacts_bulk_distribute_${mode}`}
        className="bg-blue-50 border-blue-100"
      >
        {/* Assignment Summary — dynamic counters */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { label: "Pending", value: counts.pending },
            { label: "Assigned", value: counts.assigned },
            { label: "Pool", value: counts.pool },
            { label: "Done", value: counts.done },
            { label: "Selected Contacts", value: selectedIds.size > 0 ? selectedIds.size : total },
            { label: "Selected Callers", value: bulkCallers.length },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{s.label}</div>
              <div className="text-lg font-bold text-gray-900">{countsLoading && s.label !== "Selected Contacts" && s.label !== "Selected Callers" ? "…" : Number(s.value).toLocaleString()}</div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <UserPlus size={18} className="text-[#164FA3]" />
          <span className="text-sm text-gray-800 font-semibold">
            Distribute the {total.toLocaleString()} {filter !== "all" ? filter + " " : ""}contacts
            {cfg.territoryScoped ? " in your territory" : (districtId ? ` in ${districts.find((d) => String(d.id) === String(districtId))?.name || "this district"}` : "")}
            {designationIds.length ? ` — ${designationIds.length} designation${designationIds.length === 1 ? "" : "s"}` : ""} across callers
          </span>
        </div>

        {/* team shortcut — selects all caller accounts in the team */}
        {teams.length > 0 && (
          <div className="flex items-center gap-2">
            <select value={bulkTeam} onChange={(e) => loadTeamCallers(e.target.value)} className="h-9 px-3 rounded-lg border border-gray-200 text-sm bg-white">
              <option value="">Pick callers from a team…</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <span className="text-xs text-gray-500">or pick callers individually below</span>
          </div>
        )}

        {/* caller multi-select */}
        <div className="flex flex-wrap gap-2">
          {users.length === 0 && <span className="text-xs text-gray-500">{cfg.territoryScoped ? "No callers in your territory yet." : "No callers exist yet. Create caller users first."}</span>}
          {users.map((u) => {
            const on = bulkCallers.includes(u.id);
            return (
              <button key={u.id} onClick={() => toggleBulkCaller(u.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${on ? "bg-[#164FA3] text-white border-[#164FA3]" : "bg-white text-gray-600 border-gray-200 hover:border-[#164FA3]"}`}>
                {on ? "✓ " : ""}{u.username}
              </button>
            );
          })}
          {users.length > 1 && (
            <button onClick={() => setBulkCallers(bulkCallers.length === users.length ? [] : users.map((u) => u.id))}
              className="px-3 py-1.5 rounded-full text-xs font-medium text-[#164FA3] underline">
              {bulkCallers.length === users.length ? "clear all" : "select all"}
            </button>
          )}
        </div>

        {/* mode + action */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1">
            <button onClick={() => setBulkMode("even")} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${bulkMode === "even" ? "bg-[#164FA3] text-white" : "text-gray-600"}`}>Split evenly</button>
            <button onClick={() => setBulkMode("perCaller")} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${bulkMode === "perCaller" ? "bg-[#164FA3] text-white" : "text-gray-600"}`}>N per caller</button>
          </div>
          {bulkMode === "perCaller" && (
            <input type="number" min="1" value={perCaller} onChange={(e) => setPerCaller(e.target.value)} className="h-9 w-24 px-3 rounded-lg border border-gray-200 text-sm" placeholder="per caller" />
          )}
          <button onClick={bulkDistribute} disabled={bulkBusy || bulkCallers.length === 0} className="inline-flex items-center gap-2 bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-sm">
            {bulkBusy ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
            {bulkBusy ? "Distributing…" : bulkMode === "even"
              ? `Split evenly to ${bulkCallers.length || 0} caller(s)`
              : `Give ${perCaller || 0} each to ${bulkCallers.length || 0} caller(s)`}
          </button>
          <span className="text-xs text-gray-500">
            {filter === "pending"
              ? "Already-called (Done) contacts are excluded — you're viewing Pending only."
              : filter === "done"
              ? "Only already-called (Done) contacts will be distributed — you're viewing Done only."
              : "Distributes every contact matching the current status filter, including Done ones — switch to \"Pending\" to exclude them."}
          </span>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input type="checkbox" checked={reassignOthers} onChange={(e) => setReassignOthers(e.target.checked)} />
          Take contacts already assigned to other callers
          <span className="text-xs text-gray-400 font-normal">(off = only hand out unassigned pool)</span>
        </label>

        {/* Recall — pull assigned contacts back out of caller workspaces (no deletion) */}
        <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-blue-100">
          <button onClick={bulkRecall} disabled={bulkBusy} className="inline-flex items-center gap-2 bg-white border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 px-4 py-2 rounded-xl text-sm font-semibold">
            <UserMinus size={16} />
            {bulkCallers.length > 0 ? `Remove contacts from ${bulkCallers.length} selected caller(s)` : `Remove contacts from ALL callers${cfg.territoryScoped ? " in your territory" : ""}`}
          </button>
          <span className="text-xs text-gray-500">Contacts go back to the pool — nothing is deleted from the database.</span>
        </div>
      </CollapsibleSection>
      )}

      {/* Wrong-number cleanup bar — bulk-delete everything in this filtered view */}
      {cfg.canDeleteWrong && filter === "wrong" && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-center gap-3 flex-wrap">
          <Trash2 size={18} className="text-red-600" />
          <span className="text-sm text-gray-800 font-semibold">
            {total.toLocaleString()} wrong-number contact{total === 1 ? "" : "s"}
            {districtId ? ` in ${districts.find((d) => String(d.id) === String(districtId))?.name || "this district"}` : ""}.
          </span>
          <button onClick={bulkDeleteWrong} disabled={total === 0}
            className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-sm">
            <Trash2 size={16} />
            {`Delete all ${total.toLocaleString()} wrong number${total === 1 ? "" : "s"}`}
          </button>
          <span className="text-xs text-gray-500">Call history is kept — only the contact is removed from the calling list.</span>
        </div>
      )}

      {!loading && contacts.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap text-sm">
          {selectedIds.size > 0 && (
            <span className="font-semibold text-[#164FA3]">{selectedIds.size.toLocaleString()} selected</span>
          )}
          {total > contacts.length && (
            <button onClick={selectAllMatching} disabled={selectingAll} className="text-[#164FA3] font-medium hover:underline disabled:opacity-50">
              {selectingAll ? "Selecting…" : `Select all ${total.toLocaleString()} matching filters`}
            </button>
          )}
          {selectedIds.size > 0 && (
            <button onClick={clearSelection} className="text-gray-500 font-medium hover:underline">Clear selection</button>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-gray-400">Loading…</div>
        ) : contacts.length === 0 ? (
          <div className="p-8 text-gray-400">No contacts match.</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" checked={pageFullySelected} onChange={toggleSelectPage} aria-label="Select all on this page" />
                </th>
                {/* Fixed logical column order (PROMPT 3): Name · Phone · Designation
                    · Zone · Lok Sabha · District · Assembly · Block · Address ·
                    Status · Assigned To · Convert · Action. Header and every row
                    cell below follow this exact sequence. */}
                <th className="px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Phone Number</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Designation</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Zone</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Lok Sabha</th>
                <th className="px-4 py-3 font-semibold text-gray-600">District</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Assembly</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Block</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Address</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Assigned To</th>
                {isSuperAdmin(session) && <th className="px-4 py-3 font-semibold text-gray-600">Convert</th>}
                <th className="px-4 py-3 font-semibold text-gray-600 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c, i) => (
                <tr key={c.id} className={`border-t border-gray-100 hover:bg-gray-50 ${selectedIds.has(c.id) ? "bg-blue-50/50" : ""}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleSelect(c.id)} aria-label={`Select ${c.person_name}`} />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={c.person_name} src={c.photo_url} size={32} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3] text-[11px]" />
                      <button onClick={() => setViewingContact(c)} className="hover:underline hover:text-[#164FA3] text-left" title="View details">
                        {c.person_name}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                    <div className="flex items-center gap-2">
                      <span>{c.phone_number}</span>
                      <CallActionIcons
                        phone={c.phone_number} personName={c.person_name} contactId={c.id}
                        canLog={isCaller(session)} onLogged={load}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.designation_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.zone_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.lok_sabha_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.district_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.assembly_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.ward_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-[220px]"><div className="truncate" title={c.address || ""}>{c.address || "—"}</div></td>
                  <td className="px-4 py-3">
                    {c.is_completed ? (
                      <span className="text-emerald-700 font-medium text-xs">Done</span>
                    ) : c.locked_by_user_id ? (
                      <span className="text-amber-600 font-medium text-xs">In progress</span>
                    ) : (
                      <span className="text-gray-500 text-xs">Pending</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={c.assigned_to_user_id || ""}
                      onChange={(e) => assign(c.id, e.target.value)}
                      className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                    >
                      <option value="">— pool —</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
                    </select>
                  </td>
                  {isSuperAdmin(session) && (
                    <td className="px-4 py-3"><ConvertControl contact={c} onDone={setMessage} onFail={setError} /></td>
                  )}
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setTaskFor(c)} className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded-lg font-medium">
                      <ClipboardList size={14} /> Task
                    </button>
                    {/* The row-level Edit was a duplicate of the profile card's Edit
                        (open a contact via its name/avatar, then Edit there). Removed
                        to leave a single edit entry point. */}
                    <button onClick={() => removeContact(c)} className="inline-flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg font-medium">
                      <Trash2 size={14} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <Pagination total={total} page={page} pageSize={PAGE_SIZE} onPage={setPage} loading={loading} />

      {cfg.canAdd && showAdd && (
        <AddContactModal
          addUrl={cfg.addContactUrl}
          territory={cfg.territoryScoped ? territory : null}
          territoryLabel={cfg.territoryScoped ? territoryLabel : ""}
          scopedDistricts={cfg.territoryScoped ? districts : null}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); setError(""); setMessage("Contact created successfully."); load(); loadCounts(); }}
        />
      )}
      {editingContact && (
        <EditContactModal
          contact={editingContact}
          contactUrl={cfg.contactUrl}
          canEditGeo={cfg.canEditGeo}
          position={editingPosition}
          total={total}
          hasPrev={editingHasPrev}
          hasNext={editingHasNext}
          navBusy={editNavBusy}
          onPrev={() => editStep(-1)}
          onNext={() => editStep(1)}
          onClose={() => setEditingIndex(null)}
          onSaved={(updated) => {
            // Optimistic: show the server's fresh, fully-resolved record at once.
            setContacts((prev) => prev.map((c, i) => (i === editingIndex ? { ...c, ...updated } : c)));
            loadCounts(); // refresh Address / Photo counts after an edit (PROMPT 2)
            if (editingHasNext) editStep(1);
            else { setEditingIndex(null); load(); } // re-sync list + search/filter on close
          }}
        />
      )}
      {taskFor && <ContactTaskModal contact={taskFor} users={users} onClose={() => setTaskFor(null)} onSaved={() => { setTaskFor(null); setMessage(`Task assigned for ${taskFor.person_name}.`); }} />}
      {viewingContact && (
        <PersonDetailModal
          type="contact"
          data={viewingContact}
          onClose={() => setViewingContact(null)}
          canEdit
          canEditGeo={cfg.canEditGeo}
          canEditStatus={mode === "admin"}
          contactUrl={cfg.contactUrl}
          photoUrl={cfg.photoUrl}
          users={users}
          designations={designations}
          onSaved={(updated) => {
            // Reflect the change instantly in the modal AND the table row with
            // the server's fully-resolved record, then re-sync the list so
            // search/filter immediately use the updated value (no stale copy).
            setViewingContact(updated);
            setContacts((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
            load();
            loadCounts();
            setError("");
            setMessage("Contact updated successfully.");
          }}
        />
      )}
    </div>
  );
}

// Page-number controls (1 · 2 · 3 …) with Prev/Next. Only renders when there's
// more than one page.
function Pagination({ total, page, pageSize, onPage, loading }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  // A compact window of page numbers around the current page.
  const nums = [];
  const push = (n) => { if (n >= 1 && n <= pageCount && !nums.includes(n)) nums.push(n); };
  push(1); push(2);
  for (let n = page - 1; n <= page + 1; n++) push(n);
  push(pageCount - 1); push(pageCount);
  nums.sort((a, b) => a - b);

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="text-xs text-gray-500">Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}</div>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1 || loading}
          className="px-2.5 py-1.5 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">Prev</button>
        {nums.map((n, i) => {
          const gap = i > 0 && n - nums[i - 1] > 1;
          return (
            <span key={n} className="flex items-center">
              {gap && <span className="px-1 text-gray-400">…</span>}
              <button onClick={() => onPage(n)} disabled={loading}
                className={`min-w-[34px] px-2.5 py-1.5 rounded-lg text-sm font-semibold ${n === page ? "bg-[#164FA3] text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>{n}</button>
            </span>
          );
        })}
        <button onClick={() => onPage(page + 1)} disabled={page >= pageCount || loading}
          className="px-2.5 py-1.5 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}

// Assign a task pinned to a contact — the telecaller sees it in the workspace
// while calling that person and can update its status there.
function ContactTaskModal({ contact, users, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "medium",
    deadline: "",
    assigned_to_user_id: contact.assigned_to_user_id || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true); setError("");
    const r = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, contact_id: contact.id, district_id: contact.district_id || null }),
    });
    if (r.ok) { onSaved(); return; }
    const d = await r.json().catch(() => ({}));
    setError(d.message || "Failed to create task");
    setSaving(false);
  }

  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-3">
        <h2 className="text-xl font-bold text-gray-900">Task for {contact.person_name}</h2>
        <p className="text-xs text-gray-500 -mt-2">{contact.phone_number} · shown to the caller during the call</p>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
        <input className={inp} placeholder="Task title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <textarea className={inp} rows={2} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <select className={inp} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
          </select>
          <input type="date" className={inp} value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
        </div>
        <select className={inp} value={form.assigned_to_user_id} onChange={(e) => setForm({ ...form, assigned_to_user_id: e.target.value })}>
          <option value="">Assign to caller (optional)…</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
        </select>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={save} disabled={saving || !form.title} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">{saving ? "Saving…" : "Assign Task"}</button>
        </div>
      </div>
    </div>
  );
}

// Formats a contact into the modal's editable field shape — reused whenever
// the modal is handed a new `contact` prop (initial open, and every
// Prev/Next/save-and-advance step, since the modal stays mounted). Geography
// fields are only included when the caller may edit them (see canEditGeo).
// Convert control (Super Admin) — turns a contact into a Candidate or
// Spokesperson from its existing data. The contact is never changed or removed;
// the backend links the new record to the contact id and refuses to create a
// duplicate on a second click.
function ConvertControl({ contact, onDone, onFail }) {
  const [busy, setBusy] = useState(false);
  async function convert(target) {
    const label = target === "candidate" ? "Candidate" : "Spokesperson";
    if (!confirm(`Convert "${contact.person_name}" into a ${label}?\n\nThe contact stays exactly as it is — this only creates a new ${label} record from its details.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/contacts/${contact.id}/convert`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || "Conversion failed.");
      onDone?.(d.message || `Converted to ${label}.`);
    } catch (e) { onFail?.(e.message || "Conversion failed."); }
    finally { setBusy(false); }
  }
  return (
    <select
      value=""
      disabled={busy}
      onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) convert(v); }}
      className="text-xs border border-gray-200 rounded px-2 py-1 bg-white disabled:opacity-50"
      title="Convert this contact"
    >
      <option value="">{busy ? "Converting…" : "Convert…"}</option>
      <option value="candidate">Candidate</option>
      <option value="spokesperson">Spokesperson</option>
    </select>
  );
}

function contactToForm(contact, canEditGeo) {
  const base = {
    person_name: contact.person_name || "",
    phone_number: contact.phone_number || "",
    address: contact.address || "",
    // Multi-designation (PROMPT 5): preload every currently-assigned designation.
    designation_ids: parseDesignationIdList(contact.designation_ids ?? contact.designation_id),
    photo_url: contact.photo_url || "",
  };
  if (!canEditGeo) return base;
  return {
    ...base,
    zone_id: contact.zone_id || "",
    lok_sabha_id: contact.lok_sabha_id || "",
    district_id: contact.district_id || "",
    assembly_id: contact.assembly_id || "",
    ward_id: contact.ward_id || "",
    booth_id: contact.booth_id || "",
  };
}

// Edit-and-advance: save commits then automatically opens the next contact in
// the SAME filtered/sorted order the table shows — no return to page 1, no
// reload. Prev/Next buttons, arrow-key navigation (ignored while typing so it
// doesn't fight normal text-field cursor movement), a live "N of Total"
// counter, and an unsaved-changes guard on every way out (Cancel, backdrop,
// Escape, Prev/Next, and browser close/refresh) round out the workflow.
function EditContactModal({ contact, contactUrl, canEditGeo, position, total, hasPrev, hasNext, navBusy, onPrev, onNext, onClose, onSaved }) {
  const [form, setForm] = useState(() => contactToForm(contact, canEditGeo));
  const [zones, setZones] = useState([]);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [wards, setWards] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Upload the newly cropped photo now and hold its URL; the PUT saves it onto
  // the contact. Same flow as Add Contact (persistPhoto). blob === null clears.
  async function persistPhoto(blob) {
    if (!blob) return null;
    const fd = new FormData();
    fd.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
    const up = await fetch("/api/uploads", { method: "POST", body: fd });
    const d = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error(d.message || "Image upload failed");
    return d.url;
  }

  // The modal stays mounted across Prev/Next/save-and-advance — reset the
  // form (and the dirty baseline) whenever a DIFFERENT contact is handed in,
  // but not on every re-render of the same one.
  useEffect(() => {
    setForm(contactToForm(contact, canEditGeo));
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id]);

  const dirty = JSON.stringify(form) !== JSON.stringify(contactToForm(contact, canEditGeo));

  // Native "close the tab" warning — the in-modal Cancel/Escape/Prev/Next
  // guards below handle every in-app way out; this covers a hard refresh/close.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function guardedExit(action) {
    if (dirty && !confirm("You have unsaved changes. Discard them?")) return;
    action();
  }

  // Arrow-key Prev/Next — only when focus isn't in a text field/select, so
  // typing (which also uses arrow keys, for the cursor) is never hijacked.
  useEffect(() => {
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Escape") { e.preventDefault(); guardedExit(onClose); return; }
      if (typing) return;
      if (e.key === "ArrowRight" && hasNext) { e.preventDefault(); guardedExit(onNext); }
      else if (e.key === "ArrowLeft" && hasPrev) { e.preventDefault(); guardedExit(onPrev); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, hasPrev, hasNext]);

  // Location cascade (Zone → Lok Sabha → District → Assembly → Block) — the
  // SAME dependent behavior as Add Contact. On open the pre-filled ids drive
  // each fetch so every existing selection's option list is present and the
  // value shows; changing an upper level refetches and clears the lower ones.
  useEffect(() => {
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || []));
    if (!canEditGeo) return;
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!canEditGeo) return;
    const url = form.zone_id ? `/api/locations?parent_id=${form.zone_id}` : "/api/locations?type=lok_sabha";
    fetch(url).then((r) => r.json()).then((d) => setLokSabhas((d.locations || []).filter((l) => l.type === "lok_sabha")));
  }, [canEditGeo, form.zone_id]);
  useEffect(() => {
    if (!canEditGeo) return;
    const url = form.lok_sabha_id ? `/api/locations?parent_id=${form.lok_sabha_id}` : "/api/locations?type=district";
    fetch(url).then((r) => r.json()).then((d) => setDistricts((d.locations || []).filter((l) => l.type === "district")));
  }, [canEditGeo, form.lok_sabha_id]);
  useEffect(() => {
    if (!canEditGeo || !form.district_id) { setAssemblies([]); return; }
    fetch(`/api/locations?parent_id=${form.district_id}`).then((r) => r.json()).then((d) => setAssemblies((d.locations || []).filter((l) => l.type === "assembly")));
  }, [canEditGeo, form.district_id]);
  useEffect(() => {
    if (!canEditGeo || !form.assembly_id) { setWards([]); return; }
    fetch(`/api/locations?parent_id=${form.assembly_id}`).then((r) => r.json()).then((d) => setWards(d.locations || []));
  }, [canEditGeo, form.assembly_id]);

  async function save() {
    setSaving(true); setError("");
    const body = {
      person_name: form.person_name,
      phone_number: form.phone_number,
      address: form.address,
      designation_ids: form.designation_ids || [], // full multi-designation set
      photo_url: form.photo_url || null,
      ...(canEditGeo ? {
        zone_id: form.zone_id || null,
        lok_sabha_id: form.lok_sabha_id || null,
        district_id: form.district_id || null,
        assembly_id: form.assembly_id || null,
        ward_id: form.ward_id || null,
        booth_id: form.booth_id || null,
      } : {}),
    };
    const r = await fetch(contactUrl(contact.id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    setSaving(false);
    if (!r.ok) { setError(data.message || "Save failed"); return; }
    // Use the server's fully-resolved record (fresh display names) so the list
    // never keeps stale zone/district/assembly/designation labels. Fall back to
    // a local merge only if the API somehow didn't return the record.
    onSaved(data.contact || { ...contact, ...body });
  }

  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white";
  const lockedGeo = "w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500 truncate";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) guardedExit(onClose); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={contact.person_name} src={contact.photo_url} size={40} className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3] text-sm" />
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-gray-900 truncate">Edit Contact</h2>
              {position != null && <p className="text-xs text-gray-500">Contact {position.toLocaleString()} of {total.toLocaleString()}{dirty ? " · unsaved changes" : ""}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => guardedExit(onPrev)} disabled={!hasPrev || navBusy} title="Previous (←)" className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30">
              <ChevronLeftIcon />
            </button>
            <button onClick={() => guardedExit(onNext)} disabled={!hasNext || navBusy} title="Next (→)" className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30">
              <ChevronRightIcon />
            </button>
          </div>
        </div>
        {/* Profile photo: shows the existing photo (or a blank default) and lets
            the user upload / change / remove it. Same control & formats as Add
            Contact; the new URL is saved onto the contact by the PUT below. */}
        <div className="flex flex-col items-center gap-1.5 pb-1">
          <ProfilePhoto
            name={form.person_name} src={form.photo_url} size={92} square editable
            persist={persistPhoto} onChange={(url) => setForm((f) => ({ ...f, photo_url: url || "" }))}
            className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3]"
          />
          <span className="text-[11px] text-gray-400">Upload Photo (optional) · JPG, PNG, WEBP</span>
        </div>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
        <input className={inp} placeholder="Person name *" value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} />
        <input className={inp} placeholder="Phone number *" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
        <input className={inp} placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Designation(s)</label>
          <DesignationMultiSelect options={designations} value={form.designation_ids} onChange={(ids) => setForm({ ...form, designation_ids: ids })} />
        </div>
        {/* Location hierarchy — same field set, order and dependent cascade as
            Add Contact (Zone → Lok Sabha → District → Assembly → Block). Admins
            edit it freely; each existing value is pre-selected. */}
        {canEditGeo ? (
          <div className="grid grid-cols-2 gap-2">
            <select className={inp} value={form.zone_id} onChange={(e) => setForm({ ...form, zone_id: e.target.value, lok_sabha_id: "", district_id: "", assembly_id: "", ward_id: "" })}>
              <option value="">Zone</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
            <select className={inp} value={form.lok_sabha_id} onChange={(e) => setForm({ ...form, lok_sabha_id: e.target.value, district_id: "", assembly_id: "", ward_id: "" })}>
              <option value="">Lok Sabha</option>
              {lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select className={inp} value={form.district_id} onChange={(e) => setForm({ ...form, district_id: e.target.value, assembly_id: "", ward_id: "" })}>
              <option value="">District</option>
              {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select className={inp} value={form.assembly_id} disabled={!form.district_id} onChange={(e) => setForm({ ...form, assembly_id: e.target.value, ward_id: "" })}>
              <option value="">{form.district_id ? "Assembly" : "Pick district"}</option>
              {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className={inp} value={form.ward_id} disabled={!form.assembly_id} onChange={(e) => setForm({ ...form, ward_id: e.target.value })}>
              <option value="">{form.assembly_id ? "Block" : "Pick assembly"}</option>
              {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        ) : (
          // Supervisor: geography is fixed to their territory and not editable
          // here (server-enforced), so the contact's current Zone / Lok Sabha /
          // District / Assembly are shown read-only rather than as dropdowns.
          (contact.zone_name || contact.lok_sabha_name || contact.district_name || contact.assembly_name) && (
            <div className="grid grid-cols-2 gap-2">
              {contact.zone_name && <div className={lockedGeo}>Zone: <span className="font-medium text-gray-700">{contact.zone_name}</span></div>}
              {contact.lok_sabha_name && <div className={lockedGeo}>Lok Sabha: <span className="font-medium text-gray-700">{contact.lok_sabha_name}</span></div>}
              {contact.district_name && <div className={lockedGeo}>District: <span className="font-medium text-gray-700">{contact.district_name}</span></div>}
              {contact.assembly_name && <div className={lockedGeo}>Assembly: <span className="font-medium text-gray-700">{contact.assembly_name}</span></div>}
            </div>
          )
        )}
        <div className="flex items-center justify-between gap-2 pt-2">
          <span className="text-[11px] text-gray-400">Esc to close · ← → to move between contacts</span>
          <div className="flex gap-2">
            <button onClick={() => guardedExit(onClose)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={save} disabled={saving || !form.person_name || !form.phone_number} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">
              {saving ? "Saving…" : hasNext ? "Save & Next" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChevronLeftIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>; }
function ChevronRightIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>; }

// `territory` (supervisor mode only) locks the new contact to the supervisor's
// own scope: their geography is applied server-side regardless, and the UI
// reflects that — a fixed district for a district/assembly supervisor, or a
// choice among the zone's districts for a zone-level supervisor.
function AddContactModal({ addUrl, territory = null, territoryLabel = "", scopedDistricts = null, onClose, onSaved }) {
  const districtLocked = !!(territory && territory.district); // district/assembly anchor → fixed
  const zoneLevel = !!(territory && territory.level === "zone"); // may pick a district in-zone
  const [form, setForm] = useState({
    person_name: "", phone_number: "", address: "", designation_ids: [], photo_url: "",
    // Full location hierarchy. For a supervisor the levels their territory fixes
    // are pre-filled (and shown locked); the rest cascade from what's chosen.
    zone_id: territory?.zone ? String(territory.zone.id) : "",
    lok_sabha_id: territory?.lok_sabha ? String(territory.lok_sabha.id) : "",
    district_id: territory?.district ? String(territory.district.id) : "",
    assembly_id: territory?.assembly ? String(territory.assembly.id) : "",
    ward_id: "",
  });
  // Cascading option lists — every value comes from the location master data.
  const [zones, setZones] = useState([]);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [districts, setDistricts] = useState(scopedDistricts || []);
  const [assemblies, setAssemblies] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Highlights the mobile field when the server rejects a duplicate number.
  const [phoneDup, setPhoneDup] = useState(false);

  // Upload the cropped image to storage now and hold its URL; it's saved onto
  // the contact by the create request. blob === null clears the selection.
  async function persistPhoto(blob) {
    if (!blob) return null;
    const fd = new FormData();
    fd.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
    const up = await fetch("/api/uploads", { method: "POST", body: fd });
    const d = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error(d.message || "Image upload failed");
    return d.url;
  }

  useEffect(() => {
    fetch("/api/designations").then((r) => r.json()).then((d) => setDesignations(d.designations || []));
  }, []);

  // ----- Location cascade (Zone → Lok Sabha → District → Assembly → Block) ----
  // An admin picks freely from the top; a supervisor's upper levels are fixed by
  // territory, so those fetches are skipped and only Assembly/Block cascade.
  const adminGeo = !territory; // full free hierarchy only for admins
  useEffect(() => {
    if (!adminGeo) return;
    fetch("/api/locations?type=zone").then((r) => r.json()).then((d) => setZones(d.locations || []));
  }, [adminGeo]);
  // Lok Sabha follows the chosen Zone (all Lok Sabhas when none picked).
  useEffect(() => {
    if (!adminGeo) return;
    const url = form.zone_id ? `/api/locations?parent_id=${form.zone_id}` : "/api/locations?type=lok_sabha";
    fetch(url).then((r) => r.json()).then((d) => setLokSabhas((d.locations || []).filter((l) => l.type === "lok_sabha")));
  }, [adminGeo, form.zone_id]);
  // District follows the chosen Lok Sabha (all districts when none picked).
  useEffect(() => {
    if (!adminGeo) return;
    const url = form.lok_sabha_id ? `/api/locations?parent_id=${form.lok_sabha_id}` : "/api/locations?type=district";
    fetch(url).then((r) => r.json()).then((d) => setDistricts((d.locations || []).filter((l) => l.type === "district")));
  }, [adminGeo, form.lok_sabha_id]);
  // Assembly follows the district (admin AND supervisor).
  useEffect(() => {
    if (!form.district_id) { setAssemblies([]); return; }
    fetch(`/api/locations?parent_id=${form.district_id}`).then((r) => r.json()).then((d) => setAssemblies((d.locations || []).filter((l) => l.type === "assembly")));
  }, [form.district_id]);
  // Block (ward) follows the assembly.
  useEffect(() => {
    if (!form.assembly_id) { setBlocks([]); return; }
    fetch(`/api/locations?parent_id=${form.assembly_id}`).then((r) => r.json()).then((d) => setBlocks(d.locations || []));
  }, [form.assembly_id]);

  async function save() {
    setSaving(true); setError(""); setPhoneDup(false);
    const r = await fetch(addUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await r.json().catch(() => ({}));
    // On any error the modal stays open with every field intact so the user can
    // fix just the mobile number; a 409 is the duplicate-number case.
    if (!r.ok) { setError(data.message || "Save failed"); if (r.status === 409) setPhoneDup(true); setSaving(false); return; }
    onSaved();
  }

  const sel = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400";
  const locked = "w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-500";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-auto">
        <h2 className="text-xl font-bold text-gray-900">Add Contact</h2>
        {territory && territoryLabel && (
          <div className="bg-blue-50 border border-blue-100 text-[#164FA3] rounded-lg px-3 py-2 text-xs flex items-center gap-1.5">
            <MapPin size={14} /> Added to your territory: <span className="font-semibold">{territoryLabel}</span>
          </div>
        )}
        {/* Profile photo (optional): upload / preview / change / remove before
            saving. The image is uploaded now and its URL saved with the contact. */}
        <div className="flex flex-col items-center gap-1.5 pb-1">
          <ProfilePhoto
            name={form.person_name} src={form.photo_url} size={92} square editable
            persist={persistPhoto} onChange={(url) => setForm((f) => ({ ...f, photo_url: url || "" }))}
            className="bg-[#164FA3]/10 border border-gray-200" textClassName="text-[#164FA3]"
          />
          <span className="text-[11px] text-gray-400">Upload Photo (optional) · JPG, PNG, WEBP</span>
        </div>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-sm">{error}</div>}
        <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Person name *" value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} />
        <input className={`w-full border rounded-lg px-3 py-2 text-sm ${phoneDup ? "border-red-400 ring-1 ring-red-300 bg-red-50" : "border-gray-200"}`} placeholder="Phone number *" value={form.phone_number} onChange={(e) => { setForm({ ...form, phone_number: e.target.value }); if (phoneDup) { setPhoneDup(false); setError(""); } }} />
        <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Designation(s)</label>
          <DesignationMultiSelect options={designations} value={form.designation_ids} onChange={(ids) => setForm({ ...form, designation_ids: ids })} />
        </div>
        {/* Location hierarchy: Zone → Lok Sabha → District → Assembly → Block.
            Admin picks freely; a supervisor's territory-fixed levels are shown
            locked and only the levels below their anchor are selectable. */}
        {adminGeo ? (
          <div className="grid grid-cols-2 gap-2">
            <select className={sel} value={form.zone_id} onChange={(e) => setForm({ ...form, zone_id: e.target.value, lok_sabha_id: "", district_id: "", assembly_id: "", ward_id: "" })}>
              <option value="">Zone</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
            <select className={sel} value={form.lok_sabha_id} onChange={(e) => setForm({ ...form, lok_sabha_id: e.target.value, district_id: "", assembly_id: "", ward_id: "" })}>
              <option value="">Lok Sabha</option>
              {lokSabhas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select className={sel} value={form.district_id} onChange={(e) => setForm({ ...form, district_id: e.target.value, assembly_id: "", ward_id: "" })}>
              <option value="">District</option>
              {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select className={sel} value={form.assembly_id} disabled={!form.district_id} onChange={(e) => setForm({ ...form, assembly_id: e.target.value, ward_id: "" })}>
              <option value="">{form.district_id ? "Assembly" : "Pick district"}</option>
              {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className={sel} value={form.ward_id} disabled={!form.assembly_id} onChange={(e) => setForm({ ...form, ward_id: e.target.value })}>
              <option value="">{form.assembly_id ? "Block" : "Pick assembly"}</option>
              {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Supervisor: upper geography comes from their territory. */}
            {territory.zone && <div className={locked}>Zone: <span className="font-medium text-gray-700">{territory.zone.name}</span></div>}
            {territory.lok_sabha && <div className={locked}>Lok Sabha: <span className="font-medium text-gray-700">{territory.lok_sabha.name}</span></div>}
            {districtLocked ? (
              <div className={locked}>District: <span className="font-medium text-gray-700">{territory.district.name}</span></div>
            ) : (
              <select className={sel} value={form.district_id} onChange={(e) => setForm({ ...form, district_id: e.target.value, assembly_id: "", ward_id: "" })}>
                <option value="">{zoneLevel ? "Select a district in your zone *" : "District"}</option>
                {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <select className={sel} value={form.assembly_id} disabled={!form.district_id} onChange={(e) => setForm({ ...form, assembly_id: e.target.value, ward_id: "" })}>
              <option value="">{form.district_id ? "Assembly" : "Pick district"}</option>
              {assemblies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select className={sel} value={form.ward_id} disabled={!form.assembly_id} onChange={(e) => setForm({ ...form, ward_id: e.target.value })}>
              <option value="">{form.assembly_id ? "Block" : "Pick assembly"}</option>
              {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          {/* A zone-level supervisor must choose a district (scope is keyed on it). */}
          <button onClick={save} disabled={saving || !form.person_name || !form.phone_number || (zoneLevel && !form.district_id)} className="px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import Excel/CSV modal — self-contained. Pick an .xlsx/.xls/.csv file, see its
// name + size, then Import. Shows a spinner while the request runs (button
// disabled, no double-submit), a hard 2-minute abort so it can never hang, the
// imported / updated / skipped / failed result with per-row failure reasons, or
// the real backend error (modal stays open to retry). On success it refreshes
// the contacts list via onImported().
// ---------------------------------------------------------------------------
function ImportModal({ url, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const fmtSize = (n) => {
    if (n == null) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  };

  async function doImport() {
    if (!file || busy) return; // guard against double-submit
    setBusy(true); setError(""); setResult(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2-min hard cap
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(url, { method: "POST", body: fd, signal: controller.signal });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.message || "Import failed. Check the file and try again."); return; }
      // Rows that failed validation (missing name, etc.) — shown as detail.
      const failedRows = (Array.isArray(d.row_errors) ? d.row_errors : []).filter((e) => e.severity === "error");
      setResult({
        total: d.total_rows || 0,
        added: d.added ?? d.contacts_inserted ?? 0,
        duplicates: d.duplicates ?? 0,
        duplicatesInFile: d.duplicates_in_file ?? 0,
        duplicatesExisting: d.duplicates_existing ?? 0,
        invalid: d.invalid ?? failedRows.length,
        failedRows: failedRows.slice(0, 50),
        unmatchedAssemblies: d.unmatched_assemblies || [],
        unmatchedDistricts: d.unmatched_districts || [],
      });
      onImported(); // refresh the contacts list so new rows appear immediately
    } catch (e) {
      setError(e?.name === "AbortError"
        ? "Import timed out. Try a smaller file or split it into batches."
        : "Import failed — network error. Please try again.");
    } finally {
      clearTimeout(timeoutId);
      setBusy(false);
    }
  }

  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm";
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Import Contacts (Excel / CSV)</h2>
          <button onClick={onClose} disabled={busy} className="text-gray-400 hover:text-gray-600 disabled:opacity-40"><X size={20} /></button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {!result ? (
            <>
              <p className="text-sm text-gray-500">
                Accepted formats: <span className="font-medium text-gray-700">.xlsx, .xls, .csv</span>. Columns are matched
                by header name (Name, Phone/Mobile, District, Assembly, Designation, Address…), in any order.
              </p>

              <input
                ref={inputRef} type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="hidden"
                onChange={(e) => { setError(""); setFile(e.target.files?.[0] || null); }}
              />

              {file ? (
                <div className="flex items-center gap-3 border border-gray-200 rounded-xl p-3">
                  <FileSpreadsheet size={22} className="text-emerald-600 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-gray-800 truncate">{file.name}</div>
                    <div className="text-xs text-gray-400">{fmtSize(file.size)}</div>
                  </div>
                  <button onClick={() => inputRef.current?.click()} disabled={busy} className="text-xs font-semibold text-[#164FA3] hover:underline disabled:opacity-40">Change</button>
                </div>
              ) : (
                <button
                  onClick={() => inputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-200 rounded-xl p-6 text-center hover:border-[#164FA3]/40 hover:bg-blue-50/30"
                >
                  <Upload size={22} className="mx-auto text-gray-400 mb-1.5" />
                  <div className="text-sm font-semibold text-gray-700">Choose a file</div>
                  <div className="text-xs text-gray-400 mt-0.5">.xlsx, .xls or .csv</div>
                </button>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2.5 text-sm flex items-start gap-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{error}</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className={`${result.added > 0 ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-gray-50 border-gray-200 text-gray-700"} border rounded-xl p-4`}>
                <div className="flex items-center gap-2 font-bold"><CheckCircle2 size={18} /> {result.added > 0 ? "Import completed successfully" : "Import completed — nothing new to add"}</div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                  <div className="text-gray-600"><span className="font-bold text-gray-900">{result.total}</span> total rows</div>
                  <div className="text-gray-600"><span className="font-bold text-emerald-700">{result.added}</span> new contacts added</div>
                  <div className="text-gray-600"><span className="font-bold text-gray-900">{result.duplicates}</span> duplicates skipped</div>
                  <div className="text-gray-600"><span className={`font-bold ${result.invalid ? "text-red-600" : "text-gray-900"}`}>{result.invalid}</span> invalid rows</div>
                </div>
                {(result.duplicatesInFile > 0 || result.duplicatesExisting > 0) && (
                  <div className="text-[11px] text-gray-400 mt-1.5">
                    Duplicates: {result.duplicatesExisting} already in the database, {result.duplicatesInFile} repeated in this file — existing contacts were left unchanged.
                  </div>
                )}
              </div>

              {result.invalid > 0 && result.failedRows.length > 0 && (
                <div className="border border-red-100 rounded-xl overflow-hidden">
                  <div className="bg-red-50 px-3 py-2 text-xs font-bold text-red-700 uppercase tracking-wide">Invalid rows</div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
                    {result.failedRows.map((e, i) => (
                      <div key={i} className="px-3 py-1.5 text-xs text-gray-600 flex gap-2">
                        <span className="font-semibold text-gray-500 shrink-0">Row {e.row}</span>
                        <span className="truncate">{e.name || e.mobile || "—"} — {(e.reasons || []).join("; ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(result.unmatchedAssemblies?.length > 0 || result.unmatchedDistricts?.length > 0) && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Some geography names didn’t match and were left blank
                  {result.unmatchedDistricts?.length ? ` — districts: ${result.unmatchedDistricts.slice(0, 5).join(", ")}${result.unmatchedDistricts.length > 5 ? "…" : ""}` : ""}
                  {result.unmatchedAssemblies?.length ? ` — assemblies: ${result.unmatchedAssemblies.slice(0, 5).join(", ")}${result.unmatchedAssemblies.length > 5 ? "…" : ""}` : ""}.
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          {!result ? (
            <>
              <button onClick={onClose} disabled={busy} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50">Cancel</button>
              <button onClick={doImport} disabled={!file || busy} className="px-5 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-60 text-white rounded-lg font-semibold inline-flex items-center gap-2">
                {busy && <Loader2 size={15} className="animate-spin" />}{busy ? "Importing…" : "Import"}
              </button>
            </>
          ) : (
            <button onClick={onClose} className="px-5 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 text-white rounded-lg font-semibold">Done</button>
          )}
        </div>
      </div>
    </div>
  );
}
