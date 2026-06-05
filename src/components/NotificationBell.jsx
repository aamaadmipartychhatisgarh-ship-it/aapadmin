"use client";

import { useEffect, useState, useRef } from "react";
import { Bell, AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import Link from "next/link";

const SEV = {
  critical: { icon: AlertCircle, color: "text-red-600 bg-red-50" },
  warning: { icon: AlertTriangle, color: "text-amber-600 bg-amber-50" },
  info: { icon: Info, color: "text-blue-600 bg-blue-50" },
};

export default function NotificationBell() {
  const [alerts, setAlerts] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const load = () => fetch("/api/notifications").then((r) => r.json()).then((d) => setAlerts(d.alerts || [])).catch(() => {});
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="relative p-2 text-gray-600 hover:text-[#0B3A82] transition-colors rounded-full hover:bg-blue-50">
        <Bell size={22} />
        {alerts.length > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-white text-[8px] text-white flex items-center justify-center font-bold">{alerts.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-bold text-gray-900 text-sm">Notifications</span>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <div className="max-h-96 overflow-auto divide-y divide-gray-100">
            {alerts.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">All clear — no alerts.</div>
            ) : alerts.map((a, i) => {
              const sev = SEV[a.severity] || SEV.info;
              const Icon = sev.icon;
              const content = (
                <div className="px-4 py-3 hover:bg-gray-50 flex gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${sev.color}`}><Icon size={16} /></div>
                  <div>
                    <div className="font-medium text-gray-900 text-sm">{a.title}</div>
                    <div className="text-xs text-gray-500">{a.body}</div>
                  </div>
                </div>
              );
              return a.link ? <Link key={i} href={a.link} onClick={() => setOpen(false)}>{content}</Link> : <div key={i}>{content}</div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
