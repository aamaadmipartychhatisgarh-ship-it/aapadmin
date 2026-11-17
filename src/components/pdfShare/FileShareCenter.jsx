"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import { FileText, FileSpreadsheet, Share2, Link2, Download, X, Loader2, Copy, Mail, MessageCircle, Check } from "lucide-react";
import {
  FILE_TYPES, subscribe, getSnapshot, clearShare, saveFile, canShareFile, shareKeptFile, installFileShareHooks, setShareNote,
} from "@/components/pdfShare/fileShare";

// The one share panel for every PDF / Excel / CSV the app exports or prints (see fileShare.js for how files reach it).
// For the file just generated it offers:
//   - Share <PDF|Excel|CSV> — the native share sheet with the ACTUAL file (WhatsApp, Email, Drive, …). Shown only where
//                             navigator.canShare({ files }) confirms this device can share this file type.
//   - Share link            — otherwise (most desktops; Excel on Android Chrome): the same file is uploaded once to a secure
//                             link that opens only after signing in, only for users with access to the page it came from, and
//                             expires in 72 hours. Copy / WhatsApp / Email / native sheet send the LINK, and say so.
//   - Download again        — the same file again (never regenerated).
// Only the latest file is kept; a new one replaces it (its name is always shown). Signing out or switching user clears it.

const fmtSize = (n) => (!n ? "" : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function FileShareCenter() {
  useEffect(() => { installFileShareHooks(); }, []);
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const { data: session, status: authStatus } = useSession();
  const signedIn = authStatus === "authenticated";
  const userId = session?.user?.id ?? null;
  const [link, setLink] = useState(null);            // { url, file } for the current file
  const [linkBusy, setLinkBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  // A file belongs to the session that made it: signing out or another user signing in clears it (and any link shown).
  const lastUser = useRef(undefined);
  useEffect(() => {
    if (authStatus === "loading") return;
    const cur = signedIn ? String(userId) : null;
    if (lastUser.current !== undefined && lastUser.current !== cur) { clearShare(); setLink(null); }
    lastUser.current = cur;
  }, [authStatus, signedIn, userId]);

  // A new file resets everything belonging to the previous one.
  useEffect(() => { setLink(null); setMsg(""); setCopied(false); }, [s.file]);

  if (s.status === "idle") return null;
  const close = () => { clearShare(); setLink(null); };
  const kind = s.kind || "pdf";
  const label = FILE_TYPES[kind]?.label || "File";
  const Icon = kind === "pdf" ? FileText : FileSpreadsheet;
  const canFile = canShareFile(s.file);
  const canShareUrl = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const curLink = link && link.file === s.file ? link.url : null;

  async function shareFile() {
    if (sharing) return;
    setMsg(""); setShareNote(""); setSharing(true);
    const r = await shareKeptFile();
    setSharing(false);
    if (r === "shared") setShareNote("Share sheet completed.");
    else if (r === "cancelled") setShareNote("Sharing cancelled.");
    else setMsg(signedIn ? "This device could not share the file. Use Share link instead." : "This device could not share the file. Attach it from your Downloads instead.");
  }
  async function makeLink() {
    if (linkBusy) return;
    setLinkBusy(true); setMsg("");
    const file = s.file;
    try {
      const r = await fetch("/api/file-share", {
        method: "POST",
        headers: { "Content-Type": file.type, "X-Filename": encodeURIComponent(s.filename), "X-Source-Path": encodeURIComponent(window.location.pathname) },
        body: file,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.path) { setMsg(d.message || "Could not create the share link."); return; }
      setLink({ url: new URL(d.path, window.location.origin).toString(), file });
    } catch { setMsg("Could not create the share link — network error."); }
    finally { setLinkBusy(false); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(curLink); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setMsg("Copy failed — select the link and copy it manually."); }
  }
  const linkText = curLink ? `${s.filename}\n${curLink}` : "";
  const btn = "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold";
  const primary = `${btn} bg-[#164FA3] text-white hover:bg-blue-800 disabled:opacity-60`;
  const secondary = `${btn} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60`;
  const heading = s.status === "loading" ? (s.note || "Preparing file…")
    : s.status === "error" ? "Could not prepare the file"
    : s.origin === "share" ? `${label} ready to share`
    : s.origin === "print" ? "PDF opened for printing"
    : `${label} downloaded`;

  return (
    <div role="dialog" aria-label="File ready to share" data-testid="pdf-share-panel" data-status={s.status} data-kind={s.status === "ready" ? kind : ""}
      className="no-print fixed z-[300] bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:bottom-4 sm:w-[390px] bg-white border border-gray-200 rounded-2xl shadow-2xl p-3.5">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${s.status === "error" ? "bg-red-50 text-red-600" : kind === "pdf" ? "bg-[#164FA3]/10 text-[#164FA3]" : "bg-emerald-50 text-emerald-700"}`}>
          {s.status === "loading" ? <Loader2 size={20} className="animate-spin" /> : <Icon size={20} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gray-900" data-testid="pdf-share-heading">{heading}</div>
          {s.status === "ready" && <div className="text-xs text-gray-600 truncate" title={s.filename} data-testid="pdf-share-filename">{s.filename}{s.size ? ` · ${fmtSize(s.size)}` : ""}</div>}
          {s.status === "error" && <div className="text-xs text-red-600 break-words" data-testid="pdf-share-error">{s.error}</div>}
        </div>
        <button type="button" onClick={close} aria-label="Close" data-testid="pdf-share-close" className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"><X size={16} /></button>
      </div>

      {s.status === "ready" && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            {canFile && (
              <button type="button" onClick={shareFile} disabled={sharing} className={primary} data-testid="pdf-share-file"><Share2 size={15} /> Share {label}</button>
            )}
            {signedIn && !curLink && (
              <button type="button" onClick={makeLink} disabled={linkBusy} className={canFile ? secondary : primary} data-testid="pdf-share-link">
                {linkBusy ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} Share link
              </button>
            )}
            <button type="button" onClick={() => saveFile(s.file, s.filename)} className={secondary} data-testid="pdf-share-download"><Download size={15} /> {s.origin === "download" ? "Download again" : "Download"}</button>
          </div>

          {curLink && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-2.5 space-y-2" data-testid="pdf-share-linkbox">
              <input readOnly value={curLink} onFocus={(e) => e.target.select()} aria-label="Share link" data-testid="pdf-share-url"
                className="w-full h-8 px-2 rounded-md border border-gray-200 bg-white text-xs text-gray-700" />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copyLink} className={secondary} data-testid="pdf-share-copy">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy link"}</button>
                <a href={`https://wa.me/?text=${encodeURIComponent(linkText)}`} target="_blank" rel="noopener noreferrer" data-no-file-share="1" className={secondary} data-testid="pdf-share-whatsapp"><MessageCircle size={15} /> WhatsApp</a>
                <a href={`mailto:?subject=${encodeURIComponent(s.filename)}&body=${encodeURIComponent(`Open the ${label} file "${s.filename}" here (sign in required; link valid for 72 hours):\n${curLink}`)}`} data-no-file-share="1" className={secondary} data-testid="pdf-share-email"><Mail size={15} /> Email</a>
                {canShareUrl && !canFile && (
                  <button type="button" onClick={() => navigator.share({ title: s.filename, text: s.filename, url: curLink }).catch(() => {})} className={secondary} data-testid="pdf-share-more"><Share2 size={15} /> More…</button>
                )}
              </div>
              <div className="text-[11px] text-gray-500" data-testid="pdf-share-linknote">
                The link opens this exact {label} file after signing in, only for users who have access to this page, and expires in 72 hours.
                WhatsApp and Email send the link — the file is not attached.
              </div>
            </div>
          )}

          {!canFile && !signedIn && (
            <div className="text-[11px] text-gray-500" data-testid="pdf-share-unsupported">This browser cannot share files. The file was downloaded — attach it from your Downloads to share it.</div>
          )}
          {s.note && <div className="text-xs text-gray-600" data-testid="pdf-share-note">{s.note}</div>}
          {msg && <div className="text-xs text-red-600">{msg}</div>}
        </div>
      )}
    </div>
  );
}
