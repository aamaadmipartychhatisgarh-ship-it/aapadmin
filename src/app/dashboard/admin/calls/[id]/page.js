"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Save, ArrowLeft, PhoneCall } from "lucide-react";

export default function EditCallPage({ params }) {
  const router = useRouter();
  // Unwrap the params promise (Next 15 standard)
  const resolvedParams = use(params);
  const id = resolvedParams.id;
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statuses, setStatuses] = useState([]);
  
  const [formData, setFormData] = useState({
    person_name: "",
    phone_number: "",
    status_id: "",
    remarks: "",
  });

  useEffect(() => {
    fetchStatuses();
    fetchCall();
  }, [id]);

  const fetchStatuses = async () => {
    const res = await fetch("/api/statuses");
    if (res.ok) {
      const data = await res.json();
      setStatuses(data.statuses);
    }
  };

  const fetchCall = async () => {
    try {
      const res = await fetch(`/api/calls/${id}`);
      if (res.ok) {
        const data = await res.json();
        const c = data.call;
        setFormData({
          person_name: c.person_name || "",
          phone_number: c.phone_number || "",
          status_id: c.status_id || "",
          remarks: c.remarks || "",
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/calls/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        router.push("/dashboard/admin/calls");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-gray-500">Loading record...</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => router.push("/dashboard/admin/calls")} className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-gray-600 hover:text-[#164FA3] shadow-sm border border-gray-100 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="w-12 h-12 rounded-full bg-[#164FA3] flex items-center justify-center text-white shadow-lg shadow-blue-900/20">
          <PhoneCall size={24} />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Edit Call Record</h1>
          <p className="text-gray-500 font-medium mt-1">Update details for this specific call.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-gray-100 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Person Name *</label>
            <input type="text" name="person_name" required value={formData.person_name} onChange={handleChange} className="w-full bg-gray-50 border border-gray-200 text-gray-900 h-11 rounded-xl px-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Phone Number *</label>
            <input type="tel" name="phone_number" required value={formData.phone_number} onChange={handleChange} className="w-full bg-gray-50 border border-gray-200 text-gray-900 h-11 rounded-xl px-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Call Status *</label>
          <select name="status_id" required value={formData.status_id} onChange={handleChange} className="w-full md:w-1/2 bg-gray-50 border border-gray-200 text-gray-900 h-11 rounded-xl px-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all">
            <option value="">Select Outcome</option>
            {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Remarks / Notes</label>
          <textarea name="remarks" value={formData.remarks} onChange={handleChange} rows="4" className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl p-4 focus:ring-2 focus:ring-[#FCB712] outline-none transition-all" placeholder="Update notes here..."></textarea>
        </div>

        <div className="flex justify-end pt-4 border-t border-gray-100">
          <button type="submit" disabled={saving} className="bg-[#164FA3] hover:bg-blue-800 text-white font-bold h-12 px-8 rounded-xl flex items-center gap-2 transition-all shadow-md disabled:opacity-70">
            <Save size={18} />
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
