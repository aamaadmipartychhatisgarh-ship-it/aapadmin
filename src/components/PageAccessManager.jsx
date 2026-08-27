"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ShieldCheck, Loader2, Plus, Trash2, Search, CheckCircle2, AlertCircle,
  Check, X, User as UserIcon, FileText, Users as UsersIcon,
} from "lucide-react";
import Avatar from "@/components/Avatar";

// BUG 14 — Super Admin Page Access Management console.
//
// Reads /api/admin/page-access (pages catalogue, grantable users, current
// grants) and drives grant/revoke through the same endpoint. Effective access
// shown here mirrors the backend exactly: a user can reach a page if their ROLE
// holds it by baseline OR the Super Admin granted it. Baseline access is shown
// as "Role" and can't be revoked (it belongs to the role, not a grant); only
// explicit grants have a Remove action.

const card = "bg-white border border-gray-200 rounded-xl";
const inp = "h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 outline-none focus:border-[#164FA3] focus:ring-1 focus:ring-[#164FA3] w-full";
const btn = "inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export default function PageAccessManager() {
  const [data, setData] = useState({ pages: [], users: [], grants: [] });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null); // { kind, text }
  const [view, setView] = useState("all"); // all | by_user | by_page

  const flash = (text) => setToast({ kind: "ok", text });
  const fail = (text) => setToast({ kind: "err", text });
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 3800); return () => clearTimeout(id); }, [toast]);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/page-access", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || "Failed to load");
      setData({ pages: d.pages || [], users: d.users || [], grants: d.grants || [] });
    } catch (e) {
      fail(e.message || "Failed to load page access.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // Multi-select assignment state: pick a user, then select any number of pages.
  const [selUser, setSelUser] = useState("");
  const [selPages, setSelPages] = useState([]); // array of page keys
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pageQ, setPageQ] = useState(""); // search filter over the page list

  // When the chosen user changes, mark the selection clean; the effect below
  // fills in their saved pages once grants are available.
  function chooseUser(id) {
    setSelUser(id);
    setDirty(false);
  }
  function togglePage(key) {
    setDirty(true);
    setSelPages((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }
  function removePage(key) {
    setDirty(true);
    setSelPages((prev) => prev.filter((k) => k !== key));
  }

  async function saveAssignment() {
    if (!selUser) { fail("Select a user first."); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/admin/page-access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: Number(selUser), page_keys: selPages }),
      });
      const d = await r.json();
      if (!r.ok) { fail(d.message || "Could not save."); return; }
      flash(d.message || "Saved.");
      setDirty(false);
      await reload();
    } catch {
      fail("Could not save page access.");
    } finally {
      setSaving(false);
    }
  }

  // Revert a user to normal role-based access (removes Page-Access management).
  async function resetToRole() {
    if (!selUser) return;
    setSaving(true);
    try {
      const r = await fetch("/api/admin/page-access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: Number(selUser), reset: true }),
      });
      const d = await r.json();
      if (!r.ok) { fail(d.message || "Could not reset."); return; }
      flash(d.message || "Reverted to role access.");
      setSelPages([]); setDirty(false);
      await reload();
    } catch {
      fail("Could not reset.");
    } finally {
      setSaving(false);
    }
  }

  async function revoke(user_id, page_key) {
    try {
      const r = await fetch("/api/admin/page-access", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id, page_key }),
      });
      const d = await r.json();
      if (!r.ok) { fail(d.message || "Could not remove access."); return; }
      flash(d.message || "Access removed.");
      await reload();
    } catch {
      fail("Could not remove access.");
    }
  }

  // --- Lookups --------------------------------------------------------------
  const pageByKey = useMemo(() => new Map(data.pages.map((p) => [p.key, p])), [data.pages]);
  const userById = useMemo(() => new Map(data.users.map((u) => [u.id, u])), [data.users]);
  const grantsByUser = useMemo(() => {
    const m = new Map();
    for (const g of data.grants) { if (!m.has(g.user_id)) m.set(g.user_id, new Set()); m.get(g.user_id).add(g.page_key); }
    return m;
  }, [data.grants]);

  // Reactively mirror the selected user's SAVED grants into the multi-select.
  // This runs on user change AND whenever the loaded grants change (initial
  // load, and the reload after a save), so an existing user's assigned pages are
  // ALWAYS pre-ticked from the database and can never show an empty selection
  // because of a load race (selecting a user before grants finished loading).
  // Unsaved edits are preserved: once the admin ticks/unticks anything (dirty),
  // the effect stops overwriting their in-progress selection until it's saved or
  // the user changes. Without this, an empty-by-race selection saved over the
  // real grants would silently wipe the user's existing access.
  useEffect(() => {
    if (dirty) return;               // don't clobber unsaved tick/untick edits
    if (!selUser) { setSelPages([]); return; }
    const grants = grantsByUser.get(Number(selUser));
    setSelPages(grants ? [...grants] : []);
  }, [selUser, grantsByUser, dirty]);

  const roleHasPage = useCallback(
    (role, key) => (pageByKey.get(key)?.baseline_roles || []).includes(role),
    [pageByKey]
  );
  // Effective access (OVERRIDE model): a user with ≥1 assigned page sees EXACTLY
  // those pages; a user with none falls back to their role baseline.
  const isGranted = useCallback((u, key) => !!grantsByUser.get(u.id)?.has(key), [grantsByUser]);
  // Effective access mirrors the backend: a MANAGED user (u.managed) has exactly
  // their assigned pages (even zero); an unmanaged user falls back to role.
  const userHasPage = useCallback(
    (u, key) => {
      if (u.managed) return !!grantsByUser.get(u.id)?.has(key);
      return roleHasPage(u.role, key);
    },
    [roleHasPage, grantsByUser]
  );

  if (loading) {
    return <div className="flex h-56 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-[90] flex items-center gap-2 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg ${toast.kind === "ok" ? "bg-emerald-600" : "bg-red-600"}`}>
          {toast.kind === "ok" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}{toast.text}
        </div>
      )}

      {/* Assignment panel — Select User → multi-select Pages → Save.
          Saving persists EXACTLY the selected pages for that user (override):
          a user with ≥1 assigned page sees only those pages; clearing all
          selections reverts them to their normal role access. */}
      <div className={`${card} p-5`}>
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={18} className="text-[#164FA3]" />
          <h3 className="text-base font-bold text-gray-900">Assign Pages to a User</h3>
        </div>
        <p className="text-xs text-gray-500 mb-4">Select a user, tick every page they should have, then Save. Assigning pages restricts the user to exactly those pages — no other module is added automatically.</p>

        <div className="max-w-md mb-4">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Select User</label>
          <select className={inp} value={selUser} onChange={(e) => chooseUser(e.target.value)}>
            <option value="">— Choose a user —</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>{u.username} — {u.role_label}</option>
            ))}
          </select>
        </div>

        {selUser && (() => {
          const u = userById.get(Number(selUser));
          // System-required (locked) pages for this user's role — always kept
          // even when managed, shown ticked+disabled so they can't be removed.
          const fixedSet = new Set(u?.fixed_pages || []);
          return (
          <>
            {/* Current DB state for this user (§18) */}
            {u && (
              <div className={`mb-3 text-xs rounded-lg px-3 py-2 border ${u.managed ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-amber-50 border-amber-100 text-amber-800"}`}>
                {u.managed
                  ? <>Managed by Page Access — this user can access <strong>exactly</strong> the pages saved below (role defaults do not apply).</>
                  : <>Not yet managed — currently on <strong>{u.role_label}</strong> role defaults. Saving switches them to explicit page access (only the pages you pick).</>}
                {fixedSet.size > 0 && (
                  <div className="mt-1 text-[11px] text-gray-500">
                    Locked pages for this role are always available and can’t be removed: <strong>{[...fixedSet].map((k) => pageByKey.get(k)?.label || k).join(", ")}</strong>.
                  </div>
                )}
              </div>
            )}
            {/* Selected pages as removable tags */}
            <div className="mb-3">
              <div className="text-xs font-semibold text-gray-500 mb-1.5">Selected pages ({selPages.length})</div>
              {selPages.length === 0 ? (
                <div className="text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg px-3 py-2">
                  None selected — this user will use their normal role access.
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {selPages.map((k) => (
                    <span key={k} className="inline-flex items-center gap-1 bg-blue-50 text-[#164FA3] border border-blue-100 rounded-full pl-2.5 pr-1 py-0.5 text-xs font-semibold">
                      {pageByKey.get(k)?.label || k}
                      <button onClick={() => removePage(k)} className="hover:bg-blue-100 rounded-full p-0.5" aria-label={`Remove ${k}`}><X size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Every registered page — searchable, with a live count so the list
                can never silently fall short of the registry (the source of
                truth). */}
            {(() => {
              const q = pageQ.trim().toLowerCase();
              const shown = q ? data.pages.filter((p) => `${p.label} ${p.key}`.toLowerCase().includes(q)) : data.pages;
              return (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="relative flex-1">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input className={`${inp} pl-8`} placeholder="Search pages…" value={pageQ} onChange={(e) => setPageQ(e.target.value)} />
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {q ? <>{shown.length} of <strong className="text-gray-900">{data.pages.length}</strong></> : <><strong className="text-gray-900">{data.pages.length}</strong> pages</>}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-72 overflow-auto border border-gray-100 rounded-lg p-2">
                    {shown.length === 0 ? (
                      <div className="col-span-full text-xs text-gray-400 px-2 py-3 text-center">No pages match “{pageQ.trim()}”.</div>
                    ) : shown.map((p) => {
                      const locked = fixedSet.has(p.key);
                      const checked = locked || selPages.includes(p.key);
                      return (
                        <label key={p.key} title={locked ? "Always available for this role — can’t be removed" : p.key}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm ${locked ? "bg-gray-50 text-gray-500 cursor-not-allowed" : checked ? "bg-blue-50 text-[#164FA3] font-medium cursor-pointer" : "text-gray-700 hover:bg-gray-50 cursor-pointer"}`}>
                          <input type="checkbox" checked={checked} disabled={locked} onChange={() => !locked && togglePage(p.key)} className="accent-[#164FA3]" />
                          <span className="truncate">{p.label}</span>
                          {locked && <span className="ml-auto text-[9px] font-bold uppercase tracking-wide text-gray-400">Locked</span>}
                        </label>
                      );
                    })}
                  </div>
                </>
              );
            })()}

            <div className="flex items-center gap-3 mt-4 flex-wrap">
              <button onClick={saveAssignment} disabled={saving || !dirty} className={`${btn} bg-[#164FA3] text-white hover:bg-[#123f85] justify-center`}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Save Access
              </button>
              {u?.managed && (
                <button onClick={resetToRole} disabled={saving} className={`${btn} border border-gray-200 text-gray-600 hover:bg-gray-50 justify-center`}>
                  Reset to role default
                </button>
              )}
              {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
            </div>
          </>
          );
        })()}
      </div>

      {/* View switcher */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        {[
          { key: "all", label: "All Grants", icon: FileText },
          { key: "by_user", label: "By User", icon: UserIcon },
          { key: "by_page", label: "By Page", icon: UsersIcon },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`px-3.5 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 ${view === t.key ? "border-[#164FA3] text-[#164FA3]" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {view === "all" && <GrantsTable data={data} pageByKey={pageByKey} onRevoke={revoke} />}
      {view === "by_user" && <ByUser data={data} userHasPage={userHasPage} isGranted={isGranted} onRevoke={revoke} />}
      {view === "by_page" && <ByPage data={data} userHasPage={userHasPage} isGranted={isGranted} onRevoke={revoke} />}
    </div>
  );
}

// ---- All Grants table (explicit grants only, with filters) -----------------
function GrantsTable({ data, pageByKey, onRevoke }) {
  const [qUser, setQUser] = useState("");
  const [qPage, setQPage] = useState("");
  const [role, setRole] = useState("");
  const roles = useMemo(() => [...new Set(data.grants.map((g) => g.role))], [data.grants]);

  const rows = data.grants.filter((g) => {
    if (qUser && !g.username.toLowerCase().includes(qUser.toLowerCase())) return false;
    if (qPage && !(g.page_label || "").toLowerCase().includes(qPage.toLowerCase())) return false;
    if (role && g.role !== role) return false;
    return true;
  });

  return (
    <div className={card}>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-2 border-b border-gray-100">
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className={`${inp} pl-8`} placeholder="Search user…" value={qUser} onChange={(e) => setQUser(e.target.value)} />
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className={`${inp} pl-8`} placeholder="Search page…" value={qPage} onChange={(e) => setQPage(e.target.value)} />
        </div>
        <select className={inp} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {roles.map((r) => <option key={r} value={r}>{data.grants.find((g) => g.role === r)?.role_label || r}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold text-gray-500 border-b border-gray-100">
              <th className="px-4 py-2.5">User Name</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Page</th>
              <th className="px-4 py-2.5">Access</th>
              <th className="px-4 py-2.5">Granted</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No explicit grants yet. Use “Grant Page Access” above to add one.</td></tr>
            ) : rows.map((g) => (
              <tr key={g.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                <td className="px-4 py-2.5 font-medium text-gray-900">{g.username}</td>
                <td className="px-4 py-2.5 text-gray-600">{g.role_label}</td>
                <td className="px-4 py-2.5 text-gray-700">{g.page_label}</td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-xs font-semibold">
                    <Check size={12} /> Granted
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">{g.created_at ? new Date(g.created_at).toLocaleDateString() : "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => onRevoke(g.user_id, g.page_key)} className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 text-xs font-semibold">
                    <Trash2 size={13} /> Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- By User: pick a user, see every page ✓/✗ ------------------------------
function ByUser({ data, userHasPage, isGranted, onRevoke }) {
  const [userId, setUserId] = useState("");
  const u = data.users.find((x) => String(x.id) === String(userId));
  return (
    <div className="space-y-4">
      <div className={`${card} p-4`}>
        <label className="block text-xs font-semibold text-gray-500 mb-1">Select User</label>
        <select className={`${inp} max-w-md`} value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">— Choose a user —</option>
          {data.users.map((x) => <option key={x.id} value={x.id}>{x.username} · {x.role_label}</option>)}
        </select>
      </div>
      {u && (
        <div className={`${card} p-4`}>
          <div className="flex items-center gap-3 mb-4">
            <Avatar name={u.username} src={u.photo_url} size={40} className="bg-blue-50 border border-blue-100" textClassName="text-[#0B3A82]" />
            <div>
              <div className="font-bold text-gray-900">{u.username}</div>
              <div className="text-xs text-gray-500">Role: {u.role_label}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {data.pages.map((p) => {
              const has = userHasPage(u, p.key);
              const granted = isGranted(u, p.key);
              return (
                <div key={p.key} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${has ? "border-emerald-100 bg-emerald-50/50" : "border-gray-100 bg-gray-50/50"}`}>
                  <span className="flex items-center gap-2 text-sm">
                    {has ? <Check size={15} className="text-emerald-600" /> : <X size={15} className="text-gray-300" />}
                    <span className={has ? "text-gray-900" : "text-gray-400"}>{p.label}</span>
                  </span>
                  {granted
                    ? <button onClick={() => onRevoke(u.id, p.key)} className="text-[11px] font-semibold text-red-600 hover:text-red-700">Remove</button>
                    : has && <span className="text-[10px] font-semibold text-gray-400 uppercase">Role</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- By Page: pick a page, see which users have access ---------------------
function ByPage({ data, userHasPage, isGranted, onRevoke }) {
  const [key, setKey] = useState("");
  const page = data.pages.find((p) => p.key === key);
  const users = page ? data.users.filter((u) => userHasPage(u, key)) : [];
  return (
    <div className="space-y-4">
      <div className={`${card} p-4`}>
        <label className="block text-xs font-semibold text-gray-500 mb-1">Select Page</label>
        <select className={`${inp} max-w-md`} value={key} onChange={(e) => setKey(e.target.value)}>
          <option value="">— Choose a page —</option>
          {data.pages.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>
      {page && (
        <div className={`${card} p-4`}>
          <div className="font-bold text-gray-900 mb-1">{page.label}</div>
          <div className="text-xs text-gray-500 mb-4">{users.length} user{users.length === 1 ? "" : "s"} with access (role baseline or granted). Super Admins always have access and are not listed.</div>
          {users.length === 0 ? (
            <div className="text-sm text-gray-400 py-4">No non-admin users currently have access to this page.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {users.map((u) => {
                const granted = isGranted(u, key);
                return (
                  <div key={u.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-gray-100 bg-gray-50/50">
                    <span className="flex items-center gap-2 min-w-0">
                      <Avatar name={u.username} src={u.photo_url} size={26} className="bg-white border border-gray-200" textClassName="text-[#0B3A82]" />
                      <span className="min-w-0">
                        <span className="block text-sm text-gray-900 truncate">{u.username}</span>
                        <span className="block text-[11px] text-gray-500">{u.role_label}</span>
                      </span>
                    </span>
                    {granted
                      ? <button onClick={() => onRevoke(u.id, key)} className="text-[11px] font-semibold text-red-600 hover:text-red-700 shrink-0">Remove</button>
                      : <span className="text-[10px] font-semibold text-gray-400 uppercase shrink-0">Role</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
