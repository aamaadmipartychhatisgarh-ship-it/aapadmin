"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ShieldAlert, Zap } from "lucide-react";
import { isAdmin, ASSIGNABLE_ROLES, roleLabel, normalizeRole, ROLES } from "@/lib/permissions";

export default function UsersManagement() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [users, setUsers] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("caller");
  const [homeDistrictId, setHomeDistrictId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated" && !isAdmin(session)) {
      router.push("/dashboard");
    } else if (status === "authenticated" && isAdmin(session)) {
      fetchUsers();
      fetch("/api/locations?type=district").then((r) => r.json()).then((d) => setDistricts(d.locations || []));
    }
  }, [status, session, router]);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      if (res.ok) {
        setUsers(data.users);
      }
    } catch (err) {
      console.error("Failed to fetch users");
    }
  };

  const updateUser = async (id, patch) => {
    const r = await fetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (r.ok) fetchUsers();
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password, role, home_district_id: homeDistrictId || null }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess("User created successfully!");
        setUsername("");
        setPassword("");
        setRole("caller");
        setHomeDistrictId("");
        fetchUsers();
      } else {
        setError(data.message || "Failed to create user");
      }
    } catch (err) {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading" || !session || !isAdmin(session)) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="w-8 h-8 border-4 border-gray-900 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* Header Area */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-[2.5rem] font-bold text-gray-900 tracking-tight leading-none">User Management</h1>
          <p className="text-gray-500 mt-3 font-medium">Provision and manage application accounts</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Create User Form */}
        <div className="lg:col-span-1 bg-white rounded-[2rem] p-7 shadow-sm flex flex-col h-fit border border-gray-100">
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-[#164FA3] border border-gray-100">
                <ShieldAlert size={20} />
              </div>
              <span className="font-bold text-gray-900">Add Account</span>
            </div>
          </div>
          
          <form onSubmit={handleCreateUser} className="space-y-4">
            {error && <div className="text-red-500 text-xs font-medium bg-red-50 p-2 rounded-lg">{error}</div>}
            {success && <div className="text-green-600 text-xs font-medium bg-green-50 p-2 rounded-lg">{success}</div>}
            
            <input 
              type="text" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="Username"
              className="w-full bg-gray-100 border border-gray-200 h-12 rounded-2xl px-4 text-sm font-medium text-gray-900 focus:ring-2 focus:ring-[#164FA3] outline-none transition-all placeholder:text-gray-500"
            />
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Password"
              className="w-full bg-gray-100 border border-gray-200 h-12 rounded-2xl px-4 text-sm font-medium text-gray-900 focus:ring-2 focus:ring-[#164FA3] outline-none transition-all placeholder:text-gray-500"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full bg-gray-100 border border-gray-200 h-12 rounded-2xl px-4 text-sm font-medium text-gray-900 focus:ring-2 focus:ring-[#164FA3] outline-none appearance-none"
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>{roleLabel(r)}</option>
              ))}
            </select>
            <select
              value={homeDistrictId}
              onChange={(e) => setHomeDistrictId(e.target.value)}
              className="w-full bg-gray-100 border border-gray-200 h-12 rounded-2xl px-4 text-sm font-medium text-gray-900 focus:ring-2 focus:ring-[#164FA3] outline-none appearance-none"
            >
              <option value="">— No home district —</option>
              {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button type="submit" disabled={loading} className="w-full h-12 bg-[#164FA3] hover:bg-blue-800 text-white font-semibold rounded-2xl transition-all shadow-md mt-2">
              {loading ? "Adding..." : "Add Account"}
            </button>
          </form>
        </div>

        {/* User Directory - Dark Card */}
        <div className="lg:col-span-2 bg-[#164FA3] rounded-[2rem] p-8 shadow-xl flex flex-col text-white min-h-[400px]">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-[#FCB712] border border-white/5">
                <Zap size={20} />
              </div>
              <span className="font-bold text-white">User Directory</span>
            </div>
            <div className="bg-white/20 px-4 py-2 rounded-full text-xs font-semibold cursor-pointer border border-white/5 flex items-center gap-2 hover:bg-white/30 transition-colors">
              All Users <span className="text-white">v</span>
            </div>
          </div>

          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-blue-100 border-b border-white/10">
                  <th className="pb-3 font-semibold">User</th>
                  <th className="pb-3 font-semibold">Role</th>
                  <th className="pb-3 font-semibold">Home District</th>
                  <th className="pb-3 font-semibold">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-white/10 hover:bg-white/10 transition-colors group">
                    <td className="py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-white/20 text-white flex items-center justify-center font-bold text-xs">
                          {u.username[0].toUpperCase()}
                        </div>
                        <span className="font-semibold text-white">{u.username}</span>
                      </div>
                    </td>
                    <td className="py-4">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        ["super_admin","state_admin","admin"].includes(u.role)
                          ? 'bg-[#FCB712] text-[#164FA3]'
                          : u.role === 'supervisor'
                            ? 'bg-emerald-400 text-[#164FA3]'
                            : ["zone_admin","district_admin","assembly_admin"].includes(u.role)
                              ? 'bg-sky-300 text-[#164FA3]'
                              : 'bg-white/20 text-white'
                      }`}>
                        {roleLabel(u.role)}
                      </span>
                    </td>
                    <td className="py-4">
                      <select
                        value={u.home_district_id || ""}
                        onChange={(e) => updateUser(u.id, { home_district_id: e.target.value || null })}
                        className="bg-white/10 text-white text-xs rounded px-2 py-1 border border-white/20"
                      >
                        <option className="text-gray-900" value="">—</option>
                        {districts.map((d) => <option key={d.id} value={d.id} className="text-gray-900">{d.name}</option>)}
                      </select>
                    </td>
                    <td className="py-4 text-blue-100 font-medium">
                      {new Date(u.created_at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan="4" className="py-8 text-center text-blue-200 font-medium">
                      No users found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
