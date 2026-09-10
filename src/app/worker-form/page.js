"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Phone, ShieldCheck, LogOut, CheckCircle2, ArrowLeft } from "lucide-react";

const BRAND = "#0B3A82";
const post = (url, body) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });

export default function WorkerFormPage() {
  const [stage, setStage] = useState("loading"); // loading | phone | otp | form
  const [worker, setWorker] = useState(null);     // { name, phone } once authenticated

  // On load, resume an existing OTP session (§8/§21).
  useEffect(() => {
    let alive = true;
    fetch("/api/worker-form/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (!alive) return; if (d.authenticated) { setWorker(d.worker); setStage("form"); } else setStage("phone"); })
      .catch(() => alive && setStage("phone"));
    return () => { alive = false; };
  }, []);

  return (
    <div className="min-h-screen bg-[#f4f6f8] flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        {/* Brand header */}
        <div className="flex flex-col items-center mb-5 text-center">
          <img src="/aap_logo.jpg" alt="AAP" className="w-16 h-16 rounded-full object-contain bg-white border border-gray-200 mb-2" />
          <h1 className="text-lg font-bold text-gray-900">Vote &amp; Registration — Worker Form</h1>
          <p className="text-xs text-gray-500">Aam Aadmi Party, Chhattisgarh</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          {stage === "loading" && <div className="py-10 flex justify-center"><Loader2 className="animate-spin" style={{ color: BRAND }} size={26} /></div>}
          {stage === "phone" && <PhoneStep onSent={(w) => { setWorker(w); setStage("otp"); }} />}
          {stage === "otp" && <OtpStep phone={worker} onVerified={(w) => { setWorker(w); setStage("form"); }} onBack={() => setStage("phone")} />}
          {stage === "form" && <WorkerForm worker={worker} onLogout={() => { setWorker(null); setStage("phone"); }} />}
        </div>

        <p className="text-center text-[11px] text-gray-400 mt-4">Access is limited to registered workers. Your phone number is verified by OTP.</p>
      </div>
    </div>
  );
}

// --- Step 1: phone --------------------------------------------------------
function PhoneStep({ onSent }) {
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    const digits = phone.replace(/\D/g, "");
    if (!digits) { setErr("Please enter your phone number."); return; }
    if (digits.slice(-10).length !== 10) { setErr("Please enter a valid phone number."); return; }
    setBusy(true);
    try {
      const r = await post("/api/worker-form/request-otp", { phone });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || "Could not send OTP. Please try again."); return; }
      // Carry the entered number (last 10 digits) so verify/resend can address
      // the same OTP challenge; the OTP itself is the secret, checked server-side.
      onSent({ key: digits.slice(-10), maskedPhone: d.phone, otpLength: d.otpLength || 6, resendIn: d.resendIn || 30 });
    } catch { setErr("Could not send OTP. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-gray-900">Enter your registered phone number</h2>
        <p className="text-sm text-gray-500 mt-0.5">We'll send a one-time password (OTP) to verify it.</p>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Phone Number</label>
        <div className="flex items-center rounded-lg border border-gray-200 focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-100 overflow-hidden">
          <span className="px-3 text-sm text-gray-500 bg-gray-50 h-11 flex items-center border-r border-gray-200">+91</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" autoFocus
            placeholder="Enter 10-digit number" className="flex-1 h-11 px-3 text-sm outline-none" />
        </div>
      </div>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{err}</div>}
      <button type="submit" disabled={busy} className="w-full h-11 rounded-lg text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: BRAND }}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Phone size={16} />} Generate OTP
      </button>
    </form>
  );
}

// --- Step 2: OTP ----------------------------------------------------------
function OtpStep({ phone, onVerified, onBack }) {
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cooldown, setCooldown] = useState(phone?.resendIn || 30);
  const [info, setInfo] = useState("");
  const len = phone?.otpLength || 6;
  const timer = useRef(null);

  useEffect(() => {
    timer.current = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(timer.current);
  }, []);

  async function verify(e) {
    e.preventDefault();
    setErr(""); setInfo("");
    if (!otp.trim()) { setErr("Please enter the OTP."); return; }
    setBusy(true);
    try {
      const r = await post("/api/worker-form/verify-otp", { phone: phone?.key, otp });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || "Invalid OTP. Please try again."); return; }
      onVerified(d.worker);
    } catch { setErr("Could not verify the OTP. Please try again."); }
    finally { setBusy(false); }
  }

  async function resend() {
    if (cooldown > 0) return;
    setErr(""); setInfo("");
    setBusy(true);
    try {
      const r = await post("/api/worker-form/resend-otp", { phone: phone?.key });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || "Could not resend OTP."); return; }
      setInfo("A new OTP has been sent.");
      setCooldown(d.resendIn || 30);
    } catch { setErr("Could not resend OTP."); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <button type="button" onClick={onBack} className="text-xs text-gray-400 hover:text-gray-600 inline-flex items-center gap-1"><ArrowLeft size={13} /> Change number</button>
      <div>
        <h2 className="text-base font-bold text-gray-900">OTP Verification</h2>
        <p className="text-sm text-gray-500 mt-0.5">OTP sent to <span className="font-medium text-gray-700">{phone?.maskedPhone}</span></p>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Enter OTP</label>
        <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, len))} inputMode="numeric" autoFocus
          maxLength={len} placeholder={"•".repeat(len)}
          className="w-full h-12 rounded-lg border border-gray-200 text-center text-lg tracking-[0.5em] font-semibold outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" />
      </div>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{err}</div>}
      {info && <div className="rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm px-3 py-2">{info}</div>}
      <button type="submit" disabled={busy} className="w-full h-11 rounded-lg text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: BRAND }}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />} Verify OTP
      </button>
      <div className="text-center text-sm text-gray-500">
        Didn't receive OTP?{" "}
        <button type="button" onClick={resend} disabled={cooldown > 0 || busy} className="font-semibold text-[#164FA3] disabled:text-gray-400">
          Resend OTP{cooldown > 0 ? ` (${cooldown}s)` : ""}
        </button>
      </div>
    </form>
  );
}

// --- Step 3: the Worker Form ---------------------------------------------
function WorkerForm({ worker, onLogout }) {
  const [f, setF] = useState({ address: "", area: "", remarks: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  async function logout() {
    try { await post("/api/worker-form/logout"); } catch {}
    onLogout();
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      // Only editable fields are sent; identity (name/phone) is derived server-side.
      const r = await post("/api/worker-form/submit", { ...f });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { setErr(d.message || "Session expired. Please verify again."); setTimeout(onLogout, 1200); return; }
      if (!r.ok) { setErr(d.message || "Could not submit the form. Please try again."); return; }
      setDone(true);
    } catch { setErr("Could not submit the form. Please try again."); }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="text-center py-6">
        <div className="w-14 h-14 rounded-full bg-green-50 text-green-600 flex items-center justify-center mx-auto mb-4"><CheckCircle2 size={28} /></div>
        <h2 className="text-lg font-bold text-gray-900">Submitted successfully</h2>
        <p className="text-sm text-gray-500 mt-1">Thank you, {worker?.name}. Your form has been recorded.</p>
        <button onClick={logout} className="mt-6 h-10 px-5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 inline-flex items-center gap-2"><LogOut size={15} /> Sign out</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">Worker Information</h2>
        <button type="button" onClick={logout} className="text-xs text-gray-400 hover:text-gray-600 inline-flex items-center gap-1"><LogOut size={13} /> Sign out</button>
      </div>

      {/* Verified identity — read-only, from the registration (§9/§10/§11). */}
      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
          <input value={worker?.name || ""} readOnly disabled className="w-full h-11 rounded-lg border border-gray-200 bg-gray-50 text-sm px-3 text-gray-800 font-medium" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Registered Phone Number</label>
          <input value={worker?.phone ? `+91 ${worker.phone}` : ""} readOnly disabled className="w-full h-11 rounded-lg border border-gray-200 bg-gray-50 text-sm px-3 text-gray-800 font-medium" />
        </div>
      </div>

      <div className="border-t border-gray-100 pt-3 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Address</label>
          <textarea value={f.address} onChange={(e) => set("address", e.target.value)} rows={2} className="w-full rounded-lg border border-gray-200 text-sm px-3 py-2 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" placeholder="Your address" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Area / Booth</label>
          <input value={f.area} onChange={(e) => set("area", e.target.value)} className="w-full h-11 rounded-lg border border-gray-200 text-sm px-3 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" placeholder="Area or booth" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Remarks</label>
          <textarea value={f.remarks} onChange={(e) => set("remarks", e.target.value)} rows={3} className="w-full rounded-lg border border-gray-200 text-sm px-3 py-2 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" placeholder="Any details you want to add" />
        </div>
      </div>

      {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{err}</div>}
      <button type="submit" disabled={busy} className="w-full h-11 rounded-lg text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: BRAND }}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : null} Submit Form
      </button>
    </form>
  );
}
