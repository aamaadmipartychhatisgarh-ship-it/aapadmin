"use client";

import { useEffect, useState } from "react";
import SupervisorGuard from "@/components/SupervisorGuard";
import { FileSpreadsheet, FileText, Download, Users, PhoneCall, MapPin, Building2 } from "lucide-react";

export default function Page() {
  return <SupervisorGuard><Body /></SupervisorGuard>;
}

const REPORTS = [
  { type: "workers", label: "Worker Report", desc: "All workers with activity & area.", icon: Users },
  { type: "calls", label: "Calling Report", desc: "Every call with status & duration.", icon: PhoneCall },
  { type: "areas", label: "Area-wise Report", desc: "District rollups: workers, teams, calls.", icon: MapPin },
  { type: "organization", label: "Organization Report", desc: "High-level org metrics summary.", icon: Building2 },
];

function Body() {
  const [districts, setDistricts] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [districtId, setDistrictId] = useState("");

  useEffect(() => { fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || [])); }, []);

  const qs = () => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    if (districtId) p.set("district_id", districtId);
    return p.toString();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Reports</h1>
        <p className="text-gray-500 mt-2 font-medium">Download organizational reports as Excel or PDF.</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap items-end gap-3">
        <Field label="Date from"><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inp} /></Field>
        <Field label="Date to"><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inp} /></Field>
        <Field label="District">
          <select value={districtId} onChange={(e) => setDistrictId(e.target.value)} className={inp}>
            <option value="">All districts</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.type} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-[#164FA3] flex items-center justify-center shrink-0"><Icon size={22} /></div>
              <div className="flex-1">
                <h3 className="font-bold text-gray-900">{r.label}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{r.desc}</p>
                <div className="flex gap-2 mt-3">
                  <a href={`/api/reports/export/${r.type}?${qs()}`} className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium">
                    <FileSpreadsheet size={15} /> Excel
                  </a>
                  {(r.type === "calls" || r.type === "areas") && (
                    <a href={`/api/supervisor/export/${r.type === "calls" ? "summary" : "areas"}`} className="inline-flex items-center gap-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium">
                      <FileText size={15} /> PDF
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const inp = "h-10 px-3 rounded-lg border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-[#164FA3]";
function Field({ label, children }) {
  return <div><label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</label>{children}</div>;
}
