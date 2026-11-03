"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Pencil, X } from "lucide-react";
import { useMa } from "@/components/useMa";

const fmt = (n) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY = { entry_date: today(), entry_type: "expense", category: "", description: "", amount: "" };

export default function AmountExpensesPage() {
  const { enabled } = useMa();
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading"); // loading | ok | hidden | denied
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/amount-expenses", { cache: "no-store" });
    if (r.status === 404) { setState("hidden"); return; }
    if (r.status === 401 || r.status === 403) { setState("denied"); return; }
    if (!r.ok) { setErr("Could not load."); return; }
    setData(await r.json()); setState("ok");
  }, []);
  useEffect(() => { load(); }, [load, enabled]);

  async function save(e) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const r = await fetch(editId ? `/api/amount-expenses/${editId}` : "/api/amount-expenses", { method: editId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d?.message || "Could not save."); return; }
      setForm(EMPTY); setEditId(null); await load();
    } finally { setBusy(false); }
  }
  async function del(id) {
    if (!window.confirm("Delete this entry?")) return;
    const r = await fetch(`/api/amount-expenses/${id}`, { method: "DELETE" });
    if (r.ok) load(); else setErr("Could not delete.");
  }

  if (state === "loading") return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#164FA3]" /></div>;
  if (state !== "ok") return <div data-testid="ma-unavailable" className="p-8 text-center text-gray-500">This page is not available.</div>;
  const s = data.summary;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-800">Amount &amp; Expenses</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[["Total Amount", s.total_amount, "text-emerald-700"], ["Total Expenses", s.total_expense, "text-red-700"], ["Balance", s.balance, "text-[#164FA3]"], ["Entries", s.entries, "text-gray-700"]].map(([l, v, c]) => (
          <div key={l} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm"><div className="text-xs text-gray-500">{l}</div><div className={`text-lg font-bold ${c}`}>{l === "Entries" ? v : "₹" + fmt(v)}</div></div>
        ))}
      </div>
      <form onSubmit={save} className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
        <label className="text-xs text-gray-500">Date<input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} className="w-full h-9 border border-gray-200 rounded-lg px-2 text-sm" /></label>
        <label className="text-xs text-gray-500">Type<select value={form.entry_type} onChange={(e) => setForm({ ...form, entry_type: e.target.value })} className="w-full h-9 border border-gray-200 rounded-lg px-2 text-sm"><option value="amount">Amount</option><option value="expense">Expense</option></select></label>
        <label className="text-xs text-gray-500">Category<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full h-9 border border-gray-200 rounded-lg px-2 text-sm" /></label>
        <label className="text-xs text-gray-500 md:col-span-2">Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full h-9 border border-gray-200 rounded-lg px-2 text-sm" /></label>
        <label className="text-xs text-gray-500">Amount (₹)<input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="ma-amount" className="w-full h-9 border border-gray-200 rounded-lg px-2 text-sm" /></label>
        <div className="col-span-2 md:col-span-6 flex items-center gap-2">
          <button disabled={busy} className="inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-[#164FA3] text-white text-sm font-semibold disabled:opacity-60" data-testid="ma-save"><Plus size={14} />{editId ? "Update entry" : "Add entry"}</button>
          {editId && <button type="button" onClick={() => { setEditId(null); setForm(EMPTY); }} className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border text-sm"><X size={14} />Cancel</button>}
          {err && <span className="text-xs text-red-600">{err}</span>}
        </div>
      </form>
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="p-2">Date</th><th className="p-2">Type</th><th className="p-2">Category</th><th className="p-2">Description</th><th className="p-2 text-right">Amount</th><th className="p-2" /></tr></thead>
          <tbody>
            {data.entries.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-gray-400">No entries yet.</td></tr>}
            {data.entries.map((e) => (
              <tr key={e.id} className="border-b last:border-0" data-testid="ma-row">
                <td className="p-2 whitespace-nowrap">{e.entry_date}</td>
                <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs font-semibold ${e.entry_type === "expense" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{e.entry_type === "expense" ? "Expense" : "Amount"}</span></td>
                <td className="p-2">{e.category || "—"}</td><td className="p-2">{e.description || "—"}</td>
                <td className="p-2 text-right font-semibold">₹{fmt(e.amount)}</td>
                <td className="p-2 whitespace-nowrap text-right">
                  <button onClick={() => { setEditId(e.id); setForm({ entry_date: e.entry_date, entry_type: e.entry_type, category: e.category || "", description: e.description || "", amount: String(e.amount) }); }} className="p-1 text-gray-500 hover:text-[#164FA3]" title="Edit"><Pencil size={14} /></button>
                  <button onClick={() => del(e.id)} className="p-1 text-gray-500 hover:text-red-600" title="Delete"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
