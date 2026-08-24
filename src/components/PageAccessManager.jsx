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

  // Grant form state
  const [selPage, setSelPage] = useState("");
  const [selUser, setSelUser] = useState("");
  const [granting, setGranting] = useState(false);

  async function grant() {
    if (!selPage || !selUser) { fail("Select both a page and a user."); return; }
    setGranting(true);
    try {
      const r = await fetch("/api/admin/page-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: Number(selUser), page_key: selPage }),
      });
      const d = await r.json();
      if (!r.ok) { fail(d.message || "Could not grant access."); return; }
      flash(d.message || "Access granted.");
      setSelPage(""); setSelUser("");
      await reload();
    } catch {
      fail("Could not grant access.");
    } finally {
      setGranting(false);
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

  const roleHasPage = useCallback(
    (role, key) => (pageByKey.get(key)?.baseline_roles || []).includes(role),
    [pageByKey]
  );
  // Effective access for a grantable user (role baseline ∪ explicit grants).
  const userHasPage = useCallback(
    (u, key) => roleHasPage(u.role, key) || !!grantsByUser.get(u.id)?.has(key),
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

      {/* Grant panel — Select Page → Select User → Grant Access */}
      <div className={`${card} p-5`}>
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck size={18} className="text-[#164FA3]" />
          <h3 className="text-base font-bold text-gray-900">Grant Page Access</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Select Page</label>
            <select className={inp} value={selPage} onChange={(e) => setSelPage(e.target.value)}>
              <option value="">— Choose a page —</option>
              {data.pages.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Select User</label>
            <select className={inp} value={selUser} onChange={(e) => setSelUser(e.target.value)}>
              <option value="">— Choose a user —</option>
              {data.users.map((u) => (
                <option key={u.id} value={u.id}>{u.username} · {u.role_label}</option>
              ))}
            </select>
          </div>
          <button onClick={grant} disabled={granting || !selPage || !selUser} className={`${btn} bg-[#164FA3] text-white hover:bg-[#123f85] w-full md:w-auto justify-center`}>
            {granting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Grant Access
          </button>
        </div>
        {selPage && selUser && (() => {
          const u = userById.get(Number(selUser));
          if (u && userHasPage(u, selPage)) {
            const viaRole = roleHasPage(u.role, selPage);
            return (
              <p className="mt-3 text-xs text-amber-700 flex items-center gap-1.5">
                <AlertCircle size={13} />
                {viaRole
                  ? `${u.username} already has this page through their ${u.role_label} role.`
                  : `${u.username} already has access to this page.`}
              </p>
            );
          }
          return null;
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
      {view === "by_user" && <ByUser data={data} userHasPage={userHasPage} roleHasPage={roleHasPage} onRevoke={revoke} />}
      {view === "by_page" && <ByPage data={data} userHasPage={userHasPage} roleHasPage={roleHasPage} onRevoke={revoke} />}
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
function ByUser({ data, userHasPage, roleHasPage, onRevoke }) {
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
              const viaRole = roleHasPage(u.role, p.key);
              return (
                <div key={p.key} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${has ? "border-emerald-100 bg-emerald-50/50" : "border-gray-100 bg-gray-50/50"}`}>
                  <span className="flex items-center gap-2 text-sm">
                    {has ? <Check size={15} className="text-emerald-600" /> : <X size={15} className="text-gray-300" />}
                    <span className={has ? "text-gray-900" : "text-gray-400"}>{p.label}</span>
                  </span>
                  {has && (viaRole
                    ? <span className="text-[10px] font-semibold text-gray-400 uppercase">Role</span>
                    : <button onClick={() => onRevoke(u.id, p.key)} className="text-[11px] font-semibold text-red-600 hover:text-red-700">Remove</button>
                  )}
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
function ByPage({ data, userHasPage, roleHasPage, onRevoke }) {
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
                const viaRole = roleHasPage(u.role, key);
                return (
                  <div key={u.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-gray-100 bg-gray-50/50">
                    <span className="flex items-center gap-2 min-w-0">
                      <Avatar name={u.username} src={u.photo_url} size={26} className="bg-white border border-gray-200" textClassName="text-[#0B3A82]" />
                      <span className="min-w-0">
                        <span className="block text-sm text-gray-900 truncate">{u.username}</span>
                        <span className="block text-[11px] text-gray-500">{u.role_label}</span>
                      </span>
                    </span>
                    {viaRole
                      ? <span className="text-[10px] font-semibold text-gray-400 uppercase shrink-0">Role</span>
                      : <button onClick={() => onRevoke(u.id, key)} className="text-[11px] font-semibold text-red-600 hover:text-red-700 shrink-0">Remove</button>}
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
