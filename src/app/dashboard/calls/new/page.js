"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { PhoneCall, MapPin, Save, User, FileText } from "lucide-react";
import { isAdmin, isSupervisorRole, isOversight } from "@/lib/permissions";

export default function LogCall() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated" && isOversight(session)) {
      router.push(isAdmin(session) ? "/dashboard/admin" : "/dashboard/supervisor");
    }
  }, [status, session, router]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  
  const [statuses, setStatuses] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [zones, setZones] = useState([]);
  const [lokSabhas, setLokSabhas] = useState([]);
  const [districts, setDistricts] = useState([]);

  const initialForm = {
    person_name: "",
    phone_number: "",
    address: "",
    designation_id: "",
    zone_id: "",
    lok_sabha_id: "",
    district_id: "",
    assembly_id: "",
    ward_id: "",
    polling_station_id: "",
    booth_id: "",
    status_id: "",
    remarks: "",
    duration_seconds: "",
    sentiment: "",
    is_follow_up_required: false,
    follow_up_date: "",
    is_vip: false,
  };
  const [formData, setFormData] = useState(initialForm);

  useEffect(() => {
    fetchStatuses();
    fetchLocations("zone", null, setZones);
    fetch("/api/designations").then((r) => r.ok ? r.json() : { designations: [] }).then((d) => setDesignations(d.designations || []));
  }, []);

  const fetchStatuses = async () => {
    const res = await fetch("/api/statuses");
    if (res.ok) {
      const data = await res.json();
      setStatuses(data.statuses);
    }
  };

  const fetchLocations = async (type, parentId, setter) => {
    let url = `/api/locations?type=${type}`;
    if (parentId) url += `&parent_id=${parentId}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      setter(data.locations);
    } else {
      setter([]);
    }
  };

  const handleZoneChange = (e) => {
    const val = e.target.value;
    setFormData({ ...formData, zone_id: val, lok_sabha_id: "", district_id: "" });
    setLokSabhas([]);
    setDistricts([]);
    if (val) fetchLocations("lok_sabha", val, setLokSabhas);
  };

  const handleLokSabhaChange = (e) => {
    const val = e.target.value;
    setFormData({ ...formData, lok_sabha_id: val, district_id: "" });
    setDistricts([]);
    if (val) fetchLocations("district", val, setDistricts);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({ ...formData, [name]: type === "checkbox" ? checked : value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        setMessage("Call logged successfully!");
        setFormData(initialForm);
        setLokSabhas([]);
        setDistricts([]);
      } else {
        const data = await res.json();
        setError(data.message || "Failed to log call");
      }
    } catch (err) {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-full bg-[#164FA3] flex items-center justify-center text-white shadow-lg shadow-blue-900/20">
          <PhoneCall size={24} />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Log a Call</h1>
          <p className="text-gray-500 font-medium mt-1">Record outreach details and voter sentiment.</p>
        </div>
      </div>

      {message && <div className="bg-green-50 text-green-700 p-4 rounded-xl border border-green-200 font-medium">{message}</div>}
      {error && <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200 font-medium">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* Contact Info Card */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 text-[#164FA3] mb-6">
            <User size={18} />
            <h2 className="font-bold text-lg">Contact Information</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Person Name *</label>
              <input type="text" name="person_name" required value={formData.person_name} onChange={handleChange} className="w-full bg-gray-50 border border-gray-200 text-gray-900 h-11 rounded-xl px-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Phone Number *</label>
              <input type="tel" name="phone_number" required value={formData.phone_number} onChange={handleChange} className="w-full bg-gray-50 border border-gray-200 text-gray-900 h-11 rounded-xl px-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Designation</label>
              <select name="designation_id" value={formData.designation_id} onChange={handleChange} className="w-full bg-gray-50 border border-gray-200 text-gray-900 h-11 rounded-xl px-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all">
                <option value="">Select Designation</option>
                {designations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Address</label>
              <input type="text" name="address" value={formData.address} onChange={handleChange} className="w-full bg-gray-50 border border-gray-200 text-gray-900 h-11 rounded-xl px-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all" />
            </div>
          </div>
        </div>

        {/* Location Card */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 text-[#164FA3] mb-6">
            <MapPin size={18} />
            <h2 className="font-bold text-lg">Political Geography</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Zone</label>
              <select name="zone_id" value={formData.zone_id} onChange={handleZoneChange} className="w-full bg-gray-50 border border-gray-200 text-gray-900 h-11 rounded-xl px-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all">
                <option value="">Select Zone</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Lok Sabha</label>
              <select name="lok_sabha_id" value={formData.lok_sabha_id} onChange={handleLokSabhaChange} disabled={!formData.zone_id} className="w-full bg-gray-50 border border-gray-200 text-gray-900 h-11 rounded-xl px-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all disabled:opacity-50">
                <option value="">Select Lok Sabha</option>
                {lokSabhas.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">District</label>
              <select name="district_id" value={formData.district_id} onChange={handleChange} disabled={!formData.lok_sabha_id} className="w-full bg-gray-50 border border-gray-200 text-gray-900 h-11 rounded-xl px-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all disabled:opacity-50">
                <option value="">Select District</option>
                {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-4 font-medium">* Further hierarchical levels (Assembly, Block, etc.) can be configured by admins.</p>
        </div>

        {/* Call Outcome Card */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 text-[#164FA3] mb-6">
            <FileText size={18} />
            <h2 className="font-bold text-lg">Call Outcome</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Status *</label>
              <select name="status_id" required value={formData.status_id} onChange={handleChange} className="w-full bg-gray-50 border border-gray-200 text-gray-900 h-11 rounded-xl px-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all">
                <option value="">Select Outcome</option>
                {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Sentiment</label>
              <select name="sentiment" value={formData.sentiment} onChange={handleChange} className="w-full bg-gray-50 border border-gray-200 text-gray-900 h-11 rounded-xl px-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all">
                <option value="">— not set —</option>
                <option value="positive">Positive</option>
                <option value="supporter">Supporter</option>
                <option value="neutral">Neutral</option>
                <option value="negative">Negative</option>
                <option value="opponent">Opponent</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Call Duration (seconds)</label>
              <input type="number" min="0" name="duration_seconds" value={formData.duration_seconds} onChange={handleChange} placeholder="e.g. 120" className="w-full bg-gray-50 border border-gray-200 text-gray-900 h-11 rounded-xl px-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all" />
            </div>
            <div className="flex items-center gap-6 pt-6">
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <input type="checkbox" name="is_follow_up_required" checked={formData.is_follow_up_required} onChange={handleChange} className="w-4 h-4" />
                Follow-up required
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <input type="checkbox" name="is_vip" checked={formData.is_vip} onChange={handleChange} className="w-4 h-4" />
                VIP / important contact
              </label>
            </div>
            {formData.is_follow_up_required && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Follow-up date</label>
                <input type="date" name="follow_up_date" value={formData.follow_up_date} onChange={handleChange} className="w-full bg-gray-50 border border-gray-200 text-gray-900 h-11 rounded-xl px-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all" />
              </div>
            )}
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Remarks / Notes</label>
              <textarea name="remarks" value={formData.remarks} onChange={handleChange} rows="3" className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl p-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all" placeholder="e.g. Interested in volunteering..."></textarea>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button type="submit" disabled={loading} className="bg-[#164FA3] hover:bg-blue-800 text-white font-bold h-12 px-8 rounded-xl flex items-center gap-2 transition-all shadow-md disabled:opacity-70">
            <Save size={18} />
            {loading ? "Saving..." : "Save Call Record"}
          </button>
        </div>
      </form>
    </div>
  );
}
