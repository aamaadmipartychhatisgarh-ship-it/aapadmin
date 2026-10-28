"use client";

import { unfilteredWrongReasonLabel } from "@/lib/unfilteredWrongReasons";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, Search, X, ChevronLeft, ChevronRight, ListFilter, Headphones, Shuffle, RefreshCw } from "lucide-react";
import * as XLSX from "xlsx";
import PageHeader from "@/components/PageHeader";
import { ImportModal } from "@/components/contacts/ContactsModule";
import { usePageGuard } from "@/components/usePageGuard";
import { isAdmin } from "@/lib/permissions";
import { buildHeaderIndex } from "@/lib/importHeaders";
import { normalizeIndianMobile } from "@/lib/phoneLinks";

const PAGE_SIZE = 50;

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

// Browser-side check of the chosen file, using the same header rules and phone
// validation as the server (which re-validates everything): no Phone Number
// column → import blocked; otherwise a preview of how many rows carry a valid,
// missing or invalid number and how many repeat within the file.
async function precheckFile(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const idx = buildHeaderIndex(rows[0] || []);
  if (idx.mobile === undefined) return { error: "No Phone Number column found (Phone / Mobile / Contact No). Phone Number is mandatory — add the column and try again." };
  let total = 0, valid = 0, invalid = 0, repeated = 0;
  const seen = new Set();
  for (const r of rows.slice(1)) {
    if (!r || r.every((c) => String(c ?? "").trim() === "")) continue;
    total++;
    const k = normalizeIndianMobile(String(r[idx.mobile] ?? "").trim());
    if (!k) invalid++;
    else if (seen.has(k)) repeated++;
    else { seen.add(k); valid++; }
  }
  if (!total) return { error: "The sheet has no data rows." };
  if (!valid) return { error: `None of the ${total} row(s) has a valid Phone Number, so nothing can be imported.` };
  return { info: `${total} row(s) found: ${valid} with a valid Phone Number${invalid ? `, ${invalid} missing/invalid (will be skipped)` : ""}${repeated ? `, ${repeated} repeated in the file (will be skipped)` : ""}. Numbers already in Unfiltered Contacts or Contacts are skipped on import.` };
}

// Assigned Calls — pool counts, Evenly Distribute and the caller-wise summary.
// Counts are always re-read from the server (after a distribution, on focus and
// every 30 s) so completions made by callers show up without a reload.
function AssignedCalls({ refreshKey, onDistributed }) {
  const [ov, setOv] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState(null);
  // "No. of Calls to Assign": assign UP TO this many available calls (to all callers evenly, or one caller).
  const [countIn, setCountIn] = useState("");
  const [countErr, setCountErr] = useState("");
  const [countCaller, setCountCaller] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/unfiltered-contacts/assignments", { cache: "no-store" });
      if (r.ok) setOv(await r.json());
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const t = setInterval(load, 30000);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(t); };
  }, [load]);

  async function distribute() {
    if (busy) return; // repeated clicks are ignored while one is running
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/unfiltered-contacts/assignments", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ err: true, text: d.message || "Distribution failed." }); return; }
      if (d.overview) setOv(d.overview);
      const counts = d.per_caller.map((c) => c.assigned_now);
      setMsg({ err: false, text: d.assigned > 0
        ? `Assigned ${d.assigned} call${d.assigned === 1 ? "" : "s"} among ${d.callers} caller${d.callers === 1 ? "" : "s"} (${Math.min(...counts)}–${Math.max(...counts)} each).`
        : "Nothing to assign — every available call is already assigned." });
      onDistributed?.();
    } catch {
      setMsg({ err: true, text: "Distribution failed — network error." });
    } finally {
      setBusy(false); setConfirm(false);
    }
  }

  async function assignCount() {
    if (busy) return;
    const v = countIn.trim();
    if (!v) { setCountErr("Enter the number of calls to assign."); return; }
    if (!/^\d+$/.test(v)) { setCountErr("Enter a positive whole number (digits only, no decimals or negatives)."); return; }
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < 1) { setCountErr("The number of calls must be 1 or more."); return; }
    setCountErr(""); setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/unfiltered-contacts/assignments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: n, ...(countCaller ? { caller_id: Number(countCaller) } : {}) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ err: true, text: d.message || "Assignment failed. Nothing was assigned." }); return; }
      if (d.overview) setOv(d.overview);
      const rem = d.remaining ?? d.overview?.available ?? 0;
      if (d.assigned === 0) {
        setMsg({ err: false, warn: true, text: `Requested: ${n} call${n === 1 ? "" : "s"} | Assigned: 0 — there are no unassigned calls available.` });
      } else if (d.assigned < n) {
        setMsg({ err: false, text: `Requested: ${n} calls | Assigned: ${d.assigned} call${d.assigned === 1 ? "" : "s"} because only ${d.assigned} unassigned call${d.assigned === 1 ? " was" : "s were"} available. All available calls have been assigned. Remaining unassigned: ${rem}.` });
      } else {
        setMsg({ err: false, text: `Requested: ${n} calls | Assigned: ${d.assigned} calls | Remaining unassigned: ${rem}.` });
      }
      setCountIn("");
      onDistributed?.();
    } catch {
      setMsg({ err: true, text: "Assignment failed — network error. Nothing was assigned." });
    } finally { setBusy(false); }
  }

  const k = ov?.eligible_callers || 0;
  const avail = ov?.available || 0;
  const base = k ? Math.floor(avail / k) : 0;
  const card = (label, value, tone, tid) => (
    <div className={`rounded-xl px-4 py-3 border ${tone}`} data-testid={tid}>
      <div className="text-2xl font-bold">{value ?? "—"}</div>
      <div className="text-xs mt-0.5 opacity-80">{label}</div>
    </div>
  );
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" data-testid="assigned-calls">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <Headphones size={16} className="text-[#164FA3]" />
        <h2 className="text-sm font-bold text-gray-900">Assigned Calls</h2>
        <span className="text-xs text-gray-500">{k} active caller{k === 1 ? "" : "s"}</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} className="p-2 text-gray-500 hover:bg-gray-50 rounded-lg" aria-label="Refresh counts"><RefreshCw size={15} /></button>
          <button onClick={() => setConfirm(true)} disabled={busy || !avail || !k} data-testid="evenly-distribute"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Shuffle size={15} />} Evenly Distribute
          </button>
        </div>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {card("Unfiltered Contacts available for calling", ov?.callable, "border-blue-200 bg-blue-50 text-blue-900", "ac-callable")}
          {card("Calls available for assignment", ov?.available, "border-amber-200 bg-amber-50 text-amber-900", "ac-available")}
          {card("Assigned (pending)", ov ? ov.callers.reduce((a, c) => a + c.pending, 0) : null, "border-gray-200 text-gray-900", "ac-pending")}
          {card("Completed", ov?.completed, "border-emerald-200 bg-emerald-50 text-emerald-900", "ac-completed")}
        </div>
        {ov && (ov.reassignable > 0 || ov.now_contacts > 0) && (
          <p className="text-xs text-gray-500">
            {ov.reassignable > 0 && <>{ov.reassignable} pending call{ov.reassignable === 1 ? " is" : "s are"} held by a disabled / non-caller account and will be reassigned. </>}
            {ov.now_contacts > 0 && <>{ov.now_contacts} number{ov.now_contacts === 1 ? " is" : "s are"} now in Contacts and excluded.</>}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3" data-testid="assign-count-bar">
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">No. of Calls to Assign</span>
            <input value={countIn} onChange={(e) => { setCountIn(e.target.value); if (countErr) setCountErr(""); }} inputMode="numeric" placeholder="e.g. 100" aria-label="No. of Calls to Assign" data-testid="assign-count-input"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); assignCount(); } }}
              className={`h-10 w-40 rounded-lg border px-3 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]/30 ${countErr ? "border-red-300" : "border-gray-200"}`} />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-600 mb-1">Assign to</span>
            <select value={countCaller} onChange={(e) => setCountCaller(e.target.value)} aria-label="Assign calls to" data-testid="assign-count-caller" className="h-10 rounded-lg border border-gray-200 px-2 text-sm bg-white">
              <option value="">All callers (evenly)</option>
              {(ov?.callers || []).filter((c) => c.eligible).map((c) => <option key={c.user_id} value={c.user_id}>{c.caller_name}</option>)}
            </select>
          </label>
          <button onClick={assignCount} disabled={busy || !k} data-testid="assign-count-btn"
            className="h-10 inline-flex items-center gap-2 px-4 text-sm bg-[#164FA3] hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-semibold">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Headphones size={15} />} Assign Calls
          </button>
          <span className="text-xs text-gray-500 pb-2" data-testid="assign-count-remaining">{ov ? `${ov.available} unassigned call${ov.available === 1 ? "" : "s"} available` : ""}</span>
          {countErr && <p className="basis-full text-xs text-red-600" data-testid="assign-count-error">{countErr}</p>}
        </div>
        {confirm && (
          <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 text-sm flex flex-wrap items-center gap-3" data-testid="distribute-confirm">
            <span className="text-blue-900">Distribute <b>{avail}</b> call{avail === 1 ? "" : "s"} among <b>{k}</b> active caller{k === 1 ? "" : "s"} — {base}{avail % k ? `–${base + 1}` : ""} each. Existing assignments stay as they are.</span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => setConfirm(false)} disabled={busy} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-white rounded-lg">Cancel</button>
              <button onClick={distribute} disabled={busy} data-testid="distribute-confirm-btn" className="px-3 py-1.5 text-sm bg-[#164FA3] text-white rounded-lg font-semibold inline-flex items-center gap-1.5">
                {busy && <Loader2 size={14} className="animate-spin" />} Confirm
              </button>
            </div>
          </div>
        )}
        {msg && <div className={`text-sm rounded-lg px-3 py-2 border ${msg.err ? "bg-red-50 border-red-200 text-red-700" : msg.warn ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`} data-testid="distribute-msg">{msg.text}</div>}
        <div className="overflow-x-auto border border-gray-100 rounded-lg">
          <table className="w-full text-sm min-w-[480px]" data-testid="caller-summary">
            <thead><tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
              <th className="px-4 py-2 font-semibold">Caller Name</th><th className="px-4 py-2 font-semibold text-right">Assigned Calls</th>
              <th className="px-4 py-2 font-semibold text-right">Completed Calls</th><th className="px-4 py-2 font-semibold text-right">Pending Calls</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {!ov ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400"><Loader2 className="animate-spin inline" size={16} /></td></tr>
              ) : ov.callers.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No active caller accounts.</td></tr>
              ) : ov.callers.map((c) => (
                <tr key={c.user_id} data-testid="caller-row">
                  <td className="px-4 py-2 font-medium text-gray-900">{c.caller_name}{!c.eligible && <span className="ml-2 text-[11px] text-gray-400">(inactive)</span>}</td>
                  <td className="px-4 py-2 text-right font-semibold">{c.assigned}</td>
                  <td className="px-4 py-2 text-right text-emerald-700">{c.completed}</td>
                  <td className="px-4 py-2 text-right text-amber-700">{c.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function UnfilteredContactsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { ready, allowed } = usePageGuard("unfiltered_contacts", isAdmin(session));

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showImport, setShowImport] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // re-reads Assigned Calls after an import
  const [unassigning, setUnassigning] = useState(null);
  const [notice, setNotice] = useState(null);
  const [callers, setCallers] = useState([]);
  // Bulk Remove Assignment: selected assigned rows (this page), or every assigned match across pages.
  const [sel, setSel] = useState(() => new Map()); // id -> is assigned (selection spans pages)
  const [delConfirm, setDelConfirm] = useState(null); // { ids: [..] | null, all: bool, count, name? }
  const [delBusy, setDelBusy] = useState(false);
  const [allMatching, setAllMatching] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  useEffect(() => {
    if (!ready || !allowed) return;
    fetch("/api/unfiltered-contacts/assignments", { cache: "no-store" }).then((r) => r.json())
      .then((d) => setCallers((d.callers || []).filter((c) => c.eligible))).catch(() => {});
  }, [ready, allowed, refreshKey]);

  async function bulkRemove() {
    if (bulkBusy) return;
    setBulkBusy(true); setNotice(null);
    try {
      const res = await fetch("/api/unfiltered-contacts/assignments/remove", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(allMatching ? { all_matching: true, q: search } : { ids: [...sel.keys()] }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ err: true, text: d.message || "Could not remove the assignments." }); }
      else {
        setNotice({ err: false, text: `${d.message}${d.skipped ? ` ${d.skipped} already unassigned.` : ""} The calls and their contact details are kept.` });
        setSel(new Map()); setAllMatching(false);
      }
      setBulkConfirm(false);
      await load();
      setRefreshKey((k) => k + 1);
    } catch {
      setNotice({ err: true, text: "Could not remove the assignments — network error." });
      setBulkConfirm(false);
    } finally {
      setBulkBusy(false);
    }
  }

  async function assignTo(r, callerId) {
    if (unassigning || !callerId) return;
    const target = callers.find((c) => String(c.user_id) === String(callerId));
    if (r.assigned_to && !window.confirm(`Reassign ${r.person_name || r.phone_key} from ${r.assigned_to} to ${target?.caller_name}? It will leave ${r.assigned_to}'s list. The contact's details and call history are kept.`)) return;
    setUnassigning(r.id); setNotice(null);
    try {
      const res = await fetch(`/api/unfiltered-contacts/${r.id}/assignment`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caller_id: Number(callerId), expected_caller_id: r.assigned_to_user_id || 0 }),
      });
      const d = await res.json().catch(() => ({}));
      setNotice({ err: !res.ok, text: res.ok ? `${r.person_name || r.phone_key}: ${d.message}` : (d.message || "Could not assign the contact.") });
      await load();
      setRefreshKey((k) => k + 1);
    } catch {
      setNotice({ err: true, text: "Could not assign the contact — network error." });
    } finally {
      setUnassigning(null);
    }
  }

  async function removeAssignment(r) {
    if (unassigning) return;
    if (!window.confirm(`Remove ${r.assigned_to}'s assignment of ${r.person_name || r.phone_key}? The contact and its history are kept; it returns to the unassigned pool.`)) return;
    setUnassigning(r.id); setNotice(null);
    try {
      const res = await fetch(`/api/unfiltered-contacts/${r.id}/assignment?caller_id=${r.assigned_to_user_id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      setNotice({ err: !res.ok, text: res.ok ? `Assignment removed for ${r.person_name || r.phone_key}.` : (d.message || "Could not remove the assignment.") });
      await load();
      setRefreshKey((k) => k + 1);
    } catch {
      setNotice({ err: true, text: "Could not remove the assignment — network error." });
    } finally {
      setUnassigning(null);
    }
  }

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    else if (ready && !allowed) router.push("/dashboard");
  }, [status, ready, allowed, router]);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (search) p.set("q", search);
      const r = await fetch(`/api/unfiltered-contacts?${p}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || "Could not load Unfiltered Contacts."); return; }
      setData(d);
    } catch {
      setErr("Could not load Unfiltered Contacts.");
    } finally {
      setLoading(false);
    }
  }, [page, search]);
  useEffect(() => { if (ready && allowed) load(); }, [ready, allowed, load]);
  // After a delete the current page can end up empty: step back one page.
  useEffect(() => { if (data && data.contacts.length === 0 && page > 1) setPage(page - 1); }, [data, page]);
  useEffect(() => { setAllMatching(false); setSel(new Map()); }, [search]); // a new search starts a new selection

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = data?.contacts || [];
  const pageAllSelected = rows.length > 0 && rows.every((r) => sel.has(r.id));
  // selCount = calls selected (for Delete); removeCount = the assigned ones among them (for Remove Assignment).
  const selCount = allMatching ? total : sel.size;
  const removeCount = allMatching ? (data?.assigned_total ?? 0) : [...sel.values()].filter(Boolean).length;
  const toggleRow = (r) => { setAllMatching(false); setSel((s) => { const n = new Map(s); if (n.has(r.id)) n.delete(r.id); else n.set(r.id, !!r.assigned_to_user_id); return n; }); };
  const togglePage = () => { setAllMatching(false); setSel(pageAllSelected ? new Map() : new Map(rows.map((r) => [r.id, !!r.assigned_to_user_id]))); };

  // DELETE call records (the record itself - not Remove Assignment). The server does the deleting; the list
  // is re-read afterwards, so the deleted rows disappear, the counts update and deleted ids leave the selection.
  async function doDelete() {
    if (delBusy || !delConfirm) return;
    setDelBusy(true); setNotice(null);
    try {
      const single = delConfirm.ids && delConfirm.ids.length === 1 && delConfirm.single;
      const res = single
        ? await fetch(`/api/unfiltered-contacts/${delConfirm.ids[0]}`, { method: "DELETE" })
        : await fetch("/api/unfiltered-contacts/delete", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(delConfirm.all ? { all_matching: true, q: search } : { ids: delConfirm.ids }),
          });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ err: true, text: `${d.message || "Could not delete the selected calls."} The records were kept.` });
      } else {
        const gone = new Set(d.deleted_ids || (delConfirm.ids || []));
        setSel((s) => { if (delConfirm.all) return new Map(); const n = new Map(s); gone.forEach((i) => n.delete(i)); return n; });
        if (delConfirm.all) setAllMatching(false);
        setNotice({ err: false, text: `${d.message || `Deleted ${d.deleted} call record(s).`}${d.not_found ? ` ${d.not_found} no longer existed.` : ""}` });
      }
      setDelConfirm(null);
      await load();
      setRefreshKey((k) => k + 1);
    } catch {
      setNotice({ err: true, text: "Could not delete — network error. The records were kept." });
      setDelConfirm(null);
    } finally {
      setDelBusy(false);
    }
  }


  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      <PageHeader
        icon={ListFilter}
        title="Unfiltered Contact"
        backHref="/dashboard/admin/contacts"
        backLabel="Back to Contacts"
        description="Bulk-imported numbers, kept separate from Contacts."
        actions={
          <button onClick={() => setShowImport(true)} data-testid="unfiltered-import"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-[#164FA3] hover:bg-blue-800 text-white rounded-lg font-semibold">
            <Upload size={16} /> Bulk Import (Excel)
          </button>
        }
      />

      <AssignedCalls refreshKey={refreshKey} onDistributed={load} />

      {delConfirm && (
        <div className="fixed inset-0 z-[150] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid="delete-confirm">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900">Delete {delConfirm.count} call record{delConfirm.count === 1 ? "" : "s"}?</h3>
            <p className="text-sm text-gray-600 mt-2">
              {delConfirm.single
                ? <>The call record for <strong>{delConfirm.name}</strong> will be deleted</>
                : <>{delConfirm.all ? `All ${delConfirm.count} call records${search ? " matching this search" : ""}` : `The ${delConfirm.count} selected call records`} will be deleted</>}
              {" "}together with their call history and assignment. This cannot be undone. To only take a call away from a caller, use <strong>Remove assignment</strong> instead.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setDelConfirm(null)} disabled={delBusy} data-testid="delete-cancel" className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={doDelete} disabled={delBusy} data-testid="delete-confirm-yes" className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-60">
                {delBusy ? "Deleting…" : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkConfirm && (
        <div className="fixed inset-0 z-[150] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid="bulk-confirm">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900">Remove {removeCount} assignment{removeCount === 1 ? "" : "s"}?</h3>
            <p className="text-sm text-gray-600 mt-2">
              This removes the Caller assignment of {allMatching ? `all ${removeCount} assigned call${removeCount === 1 ? "" : "s"}${search ? " matching this search" : ""}` : `the ${removeCount} selected assigned call${removeCount === 1 ? "" : "s"}`}.
              The calls then show as Unassigned and leave those callers&apos; lists. <strong>Nothing is deleted</strong> — the contacts, their photos, addresses, designations and call history are kept.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setBulkConfirm(false)} disabled={bulkBusy} data-testid="bulk-cancel" className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={bulkRemove} disabled={bulkBusy} data-testid="bulk-confirm-yes" className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-60">
                {bulkBusy ? "Removing…" : "Remove assignments"}
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && <div className={`rounded-lg border px-3 py-2 text-sm ${notice.err ? "bg-red-50 border-red-200 text-red-800" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`} data-testid="unassign-notice">{notice.text}</div>}

      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <form className="flex items-center gap-2 flex-1 min-w-[220px]" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(q.trim()); }}>
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone…" aria-label="Search"
              className="w-full border border-gray-200 rounded-lg pl-9 pr-8 py-2 text-sm outline-none focus:ring-2 focus:ring-[#164FA3]" />
            {q && <button type="button" onClick={() => { setQ(""); setSearch(""); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"><X size={14} /></button>}
          </div>
          <button className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Search</button>
        </form>
        <div className="text-sm text-gray-500" data-testid="unfiltered-total">
          {search ? <>{total} match{total === 1 ? "" : "es"} · </> : null}<span className="font-semibold text-gray-900">{data?.all_total ?? 0}</span> unfiltered contact{data?.all_total === 1 ? "" : "s"}
        </div>
      </div>

      {/* Bulk Remove Assignment */}
      <div className="flex flex-wrap items-center gap-3" data-testid="bulk-bar">
        <button type="button" onClick={() => setBulkConfirm(true)} disabled={!removeCount || bulkBusy} data-testid="bulk-remove"
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg border border-red-200 text-red-700 bg-white hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed">
          Bulk Remove Assignment{removeCount ? ` (${removeCount})` : ""}
        </button>
        <button type="button" onClick={() => setDelConfirm({ ids: allMatching ? null : [...sel.keys()], all: allMatching, count: selCount })} disabled={!selCount || delBusy} data-testid="bulk-delete"
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
          Bulk Delete{selCount ? ` (${selCount})` : ""}
        </button>
        {selCount > 0 && <button type="button" onClick={() => { setSel(new Map()); setAllMatching(false); }} className="text-xs text-gray-500 hover:underline" data-testid="bulk-clear">Clear selection</button>}
        {pageAllSelected && !allMatching && total > rows.length && (
          <button type="button" onClick={() => setAllMatching(true)} className="text-xs font-semibold text-[#164FA3] hover:underline" data-testid="bulk-select-all-matching">
            Select all {total} call{total === 1 ? "" : "s"}{search ? " matching this search" : ""} (all pages)
          </button>
        )}
        {allMatching && <span className="text-xs text-gray-600" data-testid="bulk-all-note">All {total} call{total === 1 ? "" : "s"}{search ? " matching this search" : ""} are selected.</span>}
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{err}</div>}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[880px]" data-testid="unfiltered-table">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-3 py-2.5 w-8"><input type="checkbox" checked={pageAllSelected} onChange={togglePage} disabled={!rows.length} aria-label="Select all calls" data-testid="bulk-select-page" /></th>
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-4 py-2.5 font-semibold">Phone Number</th>
                <th className="px-4 py-2.5 font-semibold">District</th>
                <th className="px-4 py-2.5 font-semibold">Assembly</th>
                <th className="px-4 py-2.5 font-semibold">Designation</th>
                <th className="px-4 py-2.5 font-semibold">Address</th>
                <th className="px-4 py-2.5 font-semibold">Imported</th>
                <th className="px-4 py-2.5 font-semibold">Assigned to</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && !data ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400"><Loader2 className="animate-spin inline" size={18} /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">{search ? "No unfiltered contacts match this search." : "No unfiltered contacts yet — use Bulk Import to add some."}</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} data-testid="unfiltered-row" className="hover:bg-gray-50">
                  <td className="px-3 py-2"><input type="checkbox" checked={allMatching || sel.has(r.id)} disabled={allMatching} onChange={() => toggleRow(r)} aria-label={`Select ${r.person_name || r.phone_key}`} data-testid="bulk-select-row" /></td>
                  <td className="px-4 py-2 font-medium text-gray-900">{r.person_name || <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-2 font-mono text-gray-700" data-testid="unfiltered-phone">{r.phone_key}</td>
                  <td className="px-4 py-2 text-gray-600">{r.district || "—"}</td>
                  <td className="px-4 py-2 text-gray-600">{r.assembly || "—"}</td>
                  <td className="px-4 py-2 text-gray-600">{r.designation || "—"}</td>
                  <td className="px-4 py-2 text-gray-600 max-w-xs truncate">{r.address || "—"}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">{fmtDate(r.created_at)}{r.file_name ? <div className="truncate max-w-[180px]">{r.file_name}</div> : null}</td>
                  <td className="px-4 py-2 text-xs whitespace-nowrap" data-testid="unfiltered-assignee">
                    {r.assigned_to ? <span className="font-medium text-gray-800">{r.assigned_to}</span> : <span className="text-gray-400">Unassigned</span>}
                    {r.assigned_to && <div className={r.completed_at ? "text-emerald-700" : "text-amber-700"}>{r.completed_at ? `Completed${r.call_status_name ? ` · ${r.call_status_name}` : ""}${r.wrong_number_reason ? ` · ${unfilteredWrongReasonLabel(r.wrong_number_reason) || r.wrong_number_reason}` : ""}` : "Pending"}</div>}
                    {!r.completed_at && (
                      <select value="" onChange={(e) => assignTo(r, e.target.value)} disabled={unassigning === r.id || !callers.length} aria-label="Assign to caller" data-testid="unfiltered-assign-select"
                        className="mt-1 block max-w-[150px] border border-gray-200 rounded px-1 py-0.5 text-[11px] bg-white">
                        <option value="">{r.assigned_to ? "Reassign to…" : "Assign to…"}</option>
                        {callers.filter((c) => String(c.user_id) !== String(r.assigned_to_user_id)).map((c) => <option key={c.user_id} value={c.user_id}>{c.caller_name}</option>)}
                      </select>
                    )}
                    {r.assigned_to && (
                      <button type="button" onClick={() => removeAssignment(r)} disabled={unassigning === r.id} data-testid="unfiltered-unassign"
                        className="mt-1 text-[11px] font-semibold text-red-600 hover:underline disabled:opacity-50">
                        {unassigning === r.id ? "Removing…" : "Remove assignment"}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button type="button" onClick={() => setDelConfirm({ ids: [r.id], all: false, count: 1, single: true, name: r.person_name || r.phone_key })} disabled={delBusy} data-testid="unfiltered-delete"
                      className="text-xs font-semibold text-red-600 hover:bg-red-50 border border-red-200 rounded-lg px-2.5 py-1 disabled:opacity-50">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
            <span>Page {page} of {pages}</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 inline-flex items-center gap-1"><ChevronLeft size={14} /> Prev</button>
              <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 inline-flex items-center gap-1">Next <ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>

      {data?.batches?.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><h2 className="text-sm font-bold text-gray-900">Recent imports</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]" data-testid="unfiltered-batches">
              <thead><tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-2 font-semibold">File</th><th className="px-4 py-2 font-semibold">When</th><th className="px-4 py-2 font-semibold">By</th>
                <th className="px-4 py-2 font-semibold text-right">Total</th><th className="px-4 py-2 font-semibold text-right">Imported</th>
                <th className="px-4 py-2 font-semibold text-right">Duplicate / Skipped</th><th className="px-4 py-2 font-semibold text-right">Invalid / Missing Phone</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {data.batches.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2 text-gray-800 max-w-[220px] truncate">{b.file_name || "—"}</td>
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmtDate(b.created_at)}</td>
                    <td className="px-4 py-2 text-gray-500">{b.imported_by || "—"}</td>
                    <td className="px-4 py-2 text-right font-semibold">{b.total_rows}</td>
                    <td className="px-4 py-2 text-right text-emerald-700">{b.imported}</td>
                    <td className="px-4 py-2 text-right text-amber-700">{b.duplicates}</td>
                    <td className="px-4 py-2 text-right text-red-600">{b.invalid}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showImport && (
        <ImportModal
          url="/api/unfiltered-contacts/import"
          title="Bulk Import — Unfiltered Contact"
          hint="Phone Number is mandatory (10-digit Indian mobile; +91 / 0 / spaces are fine). Optional columns: Name, District, Assembly, Designation, Address."
          addedLabel="successfully imported"
          invalidLabel="invalid / missing phone number"
          precheck={precheckFile}
          duplicateNote={(d) => (d?.duplicates > 0 ? (
            <div className="text-[11px] text-gray-500 mt-1.5" data-testid="unfiltered-dup-note">
              Duplicate / skipped: {d.duplicates_unfiltered} already in Unfiltered Contacts, {d.duplicates_contacts} already in Contacts, {d.duplicates_in_file} repeated in this file — existing records were left unchanged.
            </div>
          ) : null)}
          onClose={() => setShowImport(false)}
          onImported={() => { setPage(1); load(); setRefreshKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}
