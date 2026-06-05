"use client";

import { useEffect, useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";

export default function Page() {
  return <SupervisorGuard><LiveBody /></SupervisorGuard>;
}

const STATUS_STYLE = {
  on_call:  { label: "On call",  dot: "bg-emerald-500", text: "text-emerald-700" },
  idle:     { label: "Idle",     dot: "bg-amber-500",   text: "text-amber-700" },
  offline:  { label: "Offline",  dot: "bg-gray-400",    text: "text-gray-600" },
};

function fmtAgo(seconds) {
  if (seconds === null || seconds === undefined) return "never";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function LiveBody() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () =>
      fetch("/api/supervisor/live")
        .then((r) => r.json())
        .then((d) => setUsers(d.users || []))
        .finally(() => setLoading(false));
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  const grouped = users.reduce((acc, u) => {
    (acc[u.status] = acc[u.status] || []).push(u);
    return acc;
  }, {});

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Live Status</h1>
        <p className="text-gray-500 mt-2 font-medium">Refreshes every 15s. Online = activity in last 2 minutes.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {["on_call", "idle", "offline"].map((s) => (
          <div key={s} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-3 h-3 rounded-full ${STATUS_STYLE[s].dot}`}></span>
              <span className="font-medium text-gray-700">{STATUS_STYLE[s].label}</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900">{(grouped[s] || []).length}</h3>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-gray-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-600">User</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Role</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Last seen</th>
                <th className="px-4 py-3 font-semibold text-gray-600">Last call</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const style = STATUS_STYLE[u.status];
                return (
                  <tr key={u.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${style.dot}`}></span>
                        <span className={`font-medium ${style.text}`}>{style.label}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{u.username}</td>
                    <td className="px-4 py-3 text-gray-600">{u.role}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtAgo(u.seconds_since_seen)}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtAgo(u.seconds_since_call)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
