"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, Search, X, ChevronLeft, ChevronRight, ListFilter } from "lucide-react";
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

  if (!ready || !allowed) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = data?.contacts || [];

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

      {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{err}</div>}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]" data-testid="unfiltered-table">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-4 py-2.5 font-semibold">Phone Number</th>
                <th className="px-4 py-2.5 font-semibold">District</th>
                <th className="px-4 py-2.5 font-semibold">Assembly</th>
                <th className="px-4 py-2.5 font-semibold">Designation</th>
                <th className="px-4 py-2.5 font-semibold">Address</th>
                <th className="px-4 py-2.5 font-semibold">Imported</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && !data ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400"><Loader2 className="animate-spin inline" size={18} /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">{search ? "No unfiltered contacts match this search." : "No unfiltered contacts yet — use Bulk Import to add some."}</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} data-testid="unfiltered-row" className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900">{r.person_name || <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-2 font-mono text-gray-700" data-testid="unfiltered-phone">{r.phone_key}</td>
                  <td className="px-4 py-2 text-gray-600">{r.district || "—"}</td>
                  <td className="px-4 py-2 text-gray-600">{r.assembly || "—"}</td>
                  <td className="px-4 py-2 text-gray-600">{r.designation || "—"}</td>
                  <td className="px-4 py-2 text-gray-600 max-w-xs truncate">{r.address || "—"}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">{fmtDate(r.created_at)}{r.file_name ? <div className="truncate max-w-[180px]">{r.file_name}</div> : null}</td>
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
          onImported={() => { setPage(1); load(); }}
        />
      )}
    </div>
  );
}
