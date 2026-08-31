"use client";

import { useEffect, useState, useCallback } from "react";
import { Share2, X, Link2, Copy, Check, MessageCircle, Mail, Loader2, AlertCircle, Smartphone } from "lucide-react";

// Share Report modal for Reports Center. On open it asks the backend to mint a
// secure, expiring share TOKEN for the current report state, builds the shareable
// URL, and offers Copy Link / WhatsApp / Email / Native Share. The token carries
// no data; opening the link re-runs the report live under the opener's own
// permissions. All actions degrade gracefully (clipboard/native-share fallbacks,
// email validation, link-generation errors).
export default function ShareReportModal({ open, onClose, moduleLabel, getConfig }) {
  const [link, setLink] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [errMsg, setErrMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState({ to: "", subject: "", message: "" });
  const [emailErr, setEmailErr] = useState("");

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  // Generate the secure link when the modal opens (once per open).
  const generate = useCallback(async () => {
    setStatus("loading"); setErrMsg(""); setLink("");
    try {
      const cfg = getConfig?.();
      if (!cfg || !cfg.module) throw new Error("Open a report first, then share it.");
      const r = await fetch("/api/reports/share", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: cfg.module, config: cfg.config }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || "Could not create the share link.");
      const url = `${window.location.origin}/dashboard/reports?share=${encodeURIComponent(d.token)}`;
      setLink(url);
      setEmail((e) => ({ ...e, subject: e.subject || `Report – ${moduleLabel || "Reports"}`, message: e.message || `Please find the requested report here:\n${url}` }));
      setStatus("ready");
    } catch (e) {
      setErrMsg(e.message || "Could not create the share link."); setStatus("error");
    }
  }, [getConfig, moduleLabel]);

  useEffect(() => {
    if (!open) return;
    setCopied(false); setToast(""); setEmailOpen(false); setEmailErr("");
    setEmail({ to: "", subject: "", message: "" });
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3200); return () => clearTimeout(t); }, [toast]);

  if (!open) return null;

  const copyLink = async () => {
    if (!link) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link);
      else {
        // Fallback for browsers without the async clipboard API / http contexts.
        const ta = document.createElement("textarea");
        ta.value = link; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.focus(); ta.select();
        const ok = document.execCommand("copy"); document.body.removeChild(ta);
        if (!ok) throw new Error("copy blocked");
      }
      setCopied(true); setToast("Report link copied successfully.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setToast("Couldn't copy automatically — select the link and copy it manually.");
    }
  };

  const shareWhatsApp = () => {
    if (!link) return;
    const text = `Please find the requested report here: ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  const nativeShare = async () => {
    if (!link) return;
    try {
      await navigator.share({ title: `Report – ${moduleLabel || "Reports"}`, text: "Please find the requested report here:", url: link });
    } catch (e) {
      if (e?.name !== "AbortError") setToast("Native share was cancelled or is unavailable.");
    }
  };

  const sendEmail = () => {
    const to = email.to.trim();
    // Basic RFC-ish email validation before opening the mail client.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { setEmailErr("Enter a valid recipient email address."); return; }
    setEmailErr("");
    const subject = encodeURIComponent(email.subject || `Report – ${moduleLabel || "Reports"}`);
    const bodyText = encodeURIComponent(`${email.message || "Please find the requested report here:"}\n\n${link}`);
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${bodyText}`;
    setToast("Opening your email app…");
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full max-w-lg rounded-2xl shadow-xl border border-gray-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
          <div className="w-9 h-9 rounded-lg bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center"><Share2 size={18} /></div>
          <div className="mr-auto">
            <h3 className="text-base font-bold text-gray-900">Share Report</h3>
            <p className="text-xs text-gray-500">A secure link that opens this exact report — same filters &amp; configuration.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          {status === "loading" && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center"><Loader2 size={16} className="animate-spin" /> Generating secure link…</div>
          )}
          {status === "error" && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div className="flex-1"><div>{errMsg}</div><button onClick={generate} className="mt-1 font-semibold text-red-800 hover:underline">Try again</button></div>
            </div>
          )}

          {status === "ready" && (
            <>
              {/* The generated link */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Shareable link</label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0 border border-gray-200 rounded-lg px-3 h-10 bg-gray-50">
                    <Link2 size={15} className="text-gray-400 shrink-0" />
                    <input readOnly value={link} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 bg-transparent text-sm text-gray-700 outline-none" />
                  </div>
                  <button onClick={copyLink} className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg bg-[#164FA3] hover:bg-[#123f85] text-white text-sm font-semibold shrink-0">
                    {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Link expires in 30 days. Only signed-in users with report access can open it.</p>
              </div>

              {/* Channels */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <ShareChip icon={Copy} label="Copy Link" onClick={copyLink} />
                <ShareChip icon={MessageCircle} label="WhatsApp" onClick={shareWhatsApp} tone="green" />
                <ShareChip icon={Mail} label="Email" onClick={() => setEmailOpen((v) => !v)} active={emailOpen} />
                {canNativeShare && <ShareChip icon={Smartphone} label="Share…" onClick={nativeShare} />}
              </div>

              {/* Email form */}
              {emailOpen && (
                <div className="border border-gray-200 rounded-xl p-3 space-y-2 bg-gray-50/60">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Recipient email</label>
                    <input type="email" value={email.to} onChange={(e) => setEmail((x) => ({ ...x, to: e.target.value }))} placeholder="name@example.com"
                      className={`w-full h-9 px-3 rounded-lg border bg-white text-sm outline-none focus:ring-1 ${emailErr ? "border-red-400 focus:ring-red-200" : "border-gray-200 focus:border-[#164FA3] focus:ring-[#164FA3]"}`} />
                    {emailErr && <span className="text-[11px] text-red-500 mt-0.5 block">{emailErr}</span>}
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Subject</label>
                    <input value={email.subject} onChange={(e) => setEmail((x) => ({ ...x, subject: e.target.value }))}
                      className="w-full h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm outline-none focus:border-[#164FA3] focus:ring-1 focus:ring-[#164FA3]" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Message</label>
                    <textarea rows={3} value={email.message} onChange={(e) => setEmail((x) => ({ ...x, message: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm outline-none focus:border-[#164FA3] focus:ring-1 focus:ring-[#164FA3] resize-y" />
                    <p className="text-[11px] text-gray-400 mt-1">The report link is added to the message automatically.</p>
                  </div>
                  <button onClick={sendEmail} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#164FA3] hover:bg-[#123f85] text-white text-sm font-semibold">
                    <Mail size={15} /> Open email
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[96] bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">{toast}</div>
      )}
    </div>
  );
}

function ShareChip({ icon: Icon, label, onClick, tone, active }) {
  const toneCls = tone === "green"
    ? "hover:border-emerald-300 hover:bg-emerald-50 text-emerald-700"
    : "hover:border-[#164FA3]/40 hover:bg-[#164FA3]/5 text-gray-700";
  return (
    <button onClick={onClick} className={`flex flex-col items-center justify-center gap-1 h-16 rounded-xl border text-xs font-semibold transition-colors ${active ? "border-[#164FA3] bg-[#164FA3]/5 text-[#164FA3]" : "border-gray-200 bg-white"} ${toneCls}`}>
      <Icon size={18} /> {label}
    </button>
  );
}
