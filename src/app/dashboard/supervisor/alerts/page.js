"use client";

import { useEffect, useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { AlertTriangle, Info } from "lucide-react";

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

function Body() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () =>
      fetch("/api/supervisor/alerts")
        .then((r) => r.json())
        .then((d) => setAlerts(d.alerts || []))
        .finally(() => setLoading(false));
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Alerts</h1>
        <p className="text-gray-500 mt-2 font-medium">Auto-generated based on activity rules. Refreshes every 30s.</p>
      </div>

      {loading ? (
        <div className="text-gray-400">Loading…</div>
      ) : alerts.length === 0 ? (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-2xl p-8 text-center">
          ✓ No alerts. Team is operating normally.
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((a, i) => {
            const Icon = a.severity === "warning" ? AlertTriangle : Info;
            const color = a.severity === "warning"
              ? "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-blue-50 border-blue-200 text-blue-800";
            return (
              <div key={i} className={`${color} border rounded-2xl p-4 flex items-start gap-3`}>
                <Icon size={20} className="shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium">{a.message}</div>
                  <div className="text-xs uppercase tracking-wide opacity-70 mt-1">{a.type.replace(/_/g, " ")}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
