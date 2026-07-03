"use client";

import { useEffect, useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

function Body() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/supervisor/attendance?date=${date}`)
      .then((r) => r.json())
      .then((d) => setRows(d.attendance || []))
      .finally(() => setLoading(false));
  }, [date]);

  // User/role filters applied client-side over the day's sessions.
  const roles = [...new Set(rows.map((r) => r.role).filter(Boolean))].sort();
  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) =>
    (!q || (r.username || "").toLowerCase().includes(q)) &&
    (!roleFilter || r.role === roleFilter)
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Attendance</h1>
          <p className="text-gray-500 mt-2 font-medium">Login / logout times based on session events.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search user…"
            className="border border-gray-300 rounded px-3 py-2 text-sm bg-white"
          />
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="border border-gray-300 rounded px-3 py-2 text-sm bg-white">
            <option value="">All roles</option>
            {roles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm bg-white"
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-gray-400">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-gray-400">No sessions {rows.length ? "match the filters" : `recorded for ${date}`}.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">User</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Role</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Login</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Logout</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Duration</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.username}</td>
                  <td className="px-4 py-3 text-gray-600">{r.role}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(r.login_at).toLocaleTimeString("en-GB")}</td>
                  <td className="px-4 py-3 text-gray-600">{r.logout_at ? new Date(r.logout_at).toLocaleTimeString("en-GB") : <span className="text-emerald-600 font-medium">active</span>}</td>
                  <td className="px-4 py-3 text-gray-700">{r.minutes_elapsed != null ? `${r.minutes_elapsed} min` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
