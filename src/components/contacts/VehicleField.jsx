"use client";

import { VEHICLES } from "@/lib/vehicleOptions";

// Vehicle field for the Add / Edit contact forms: Two Wheeler | Four Wheeler
// (leave unselected for no vehicle).
export default function VehicleField({ value, onChange, className = "" }) {
  return (
    <div className={className}>
      <label htmlFor="contact-vehicle" className="block text-xs font-semibold text-gray-500 mb-1">Vehicle</label>
      <select
        id="contact-vehicle" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
        value={value || ""} onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select vehicle</option>
        {VEHICLES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
      </select>
    </div>
  );
}
