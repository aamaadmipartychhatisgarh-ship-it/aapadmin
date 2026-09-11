"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Languages, Loader2, ShieldAlert, UserPlus, Vote, ImagePlus, Camera, List as ListIcon, ArrowLeft } from "lucide-react";

// The public form. One form, two ways in, and the ONLY difference is who ends up
// credited — which the link decides, not the person filling it:
//   • /join — the general link. Anyone can register themselves; the entry
//     belongs to the drive and to no karyakarta.
//   • /r/<token> — a link generated for one karyakarta and shared by them.
//     Every registration through it is theirs.
// So the form asks nothing about who is collecting. It cannot: there is no field
// to put a name in, which is also why nobody can claim someone else's work.
//
// It opens with what the person is (voter, or wants to become a karyakarta),
// then their own details, and nothing else.
//
// Field-first design: one column, large touch targets, and no dependency on the
// dashboard's chrome — this page is opened on a phone over mobile data, usually
// by someone who has never seen the admin panel.
const BRAND = "#0B3A82";
const ACCENT = "#164FA3";

// Every visible string in both languages. Hindi is the default because that is
// what the field runs in; the switch is for anyone who prefers English, and the
// choice is remembered on that phone. Keeping the two sets side by side is what
// stops one language quietly drifting out of date as the form changes.
const STRINGS = {
  hi: {
    org: "आम आदमी पार्टी · छत्तीसगढ़",
    fallbackTitle: "मतदाता एवं कार्यकर्ता पंजीयन",
    constituency: "विधानसभा क्षेत्र", selectConstituency: "अपना क्षेत्र चुनें…",
    savedTitle: "पंजीयन सफल!",
    savedBody: "अगला व्यक्ति जोड़ने के लिए नीचे फॉर्म भरें.",
    workerSavedTitle: "पंजीयन सफलतापूर्वक जमा हुआ",
    workerSavedBody: "धन्यवाद. आपका पंजीयन सफलतापूर्वक जमा हो गया है.",
    photo: "फोटो", choosePhoto: "फोटो चुनें", changePhoto: "फोटो बदलें", capturePhoto: "फोटो खींचें", retakePhoto: "दोबारा खींचें",
    photoHint: "JPG, PNG या WEBP · अधिकतम 5 MB", uploading: "अपलोड हो रहा है…",
    photoTooLarge: "फोटो का आकार बहुत बड़ा है. कृपया छोटी छवि अपलोड करें.",
    photoBadType: "कृपया JPG, JPEG, PNG या WEBP छवि अपलोड करें.",
    photoFailed: "फोटो अपलोड नहीं हो सकी. कृपया दोबारा प्रयास करें.",
    kbn: "कार्यकर्ता बनना है?",
    wardName: "वार्ड का नाम", wardNamePh: "वार्ड का नाम",
    booth: "बूथ",
    errWardName: "कृपया वार्ड का नाम भरें.",
    list: "सूची", myVoters: "मेरे वोटर", myWorkers: "मेरे कार्यकर्ता",
    backToForm: "फॉर्म पर वापस जाएँ", totalVoters: "कुल वोटर", totalWorkers: "कुल कार्यकर्ता",
    noRecords: "अभी तक कोई रिकॉर्ड नहीं.", listLoadErr: "सूची लोड नहीं हो सकी. कृपया दोबारा प्रयास करें.",
    handledBy: "पंजीयन कर रहे हैं", logout: "लॉगआउट",
    handlerTitle: "कार्यकर्ता पंजीयन", enterRegdMobile: "अपना पंजीकृत मोबाइल नंबर दर्ज करें",
    generateOtp: "OTP भेजें", otpVerifyTitle: "OTP सत्यापन", enterOtp: "OTP दर्ज करें",
    verifyOtp: "OTP सत्यापित करें", resendOtp: "OTP दोबारा भेजें", changeMobile: "नंबर बदलें",
    otpSentTo: "OTP भेजा गया:", notRegistered: "आप पंजीकृत नहीं हैं.", addAnother: "एक और कार्यकर्ता जोड़ें",
    errOtp: "कृपया OTP दर्ज करें.", newOtpSent: "नया OTP भेजा गया.",
    otpSending: "OTP भेजा जा रहा है…", otpInvalidFb: "गलत OTP. कृपया दोबारा प्रयास करें.",
    otpExpiredFb: "OTP की अवधि समाप्त हो गई. कृपया नया OTP भेजें.",
    otpTooManyFb: "बहुत अधिक प्रयास. कृपया कुछ देर बाद प्रयास करें.",
    otpSendFailFb: "OTP भेजने में असमर्थ. कृपया दोबारा प्रयास करें.",
    verifyUnavailable: "मोबाइल सत्यापन अभी उपलब्ध नहीं है. कृपया बाद में प्रयास करें.",
    section1: "पंजीयन फॉर्म",
    personType: "प्रकार",
    voter: "मतदाता", wantsWorker: "कार्यकर्ता बनना है",
    name: "नाम", namePh: "पूरा नाम",
    mobile: "मोबाइल नंबर", mobilePh: "10 अंकों का नंबर",
    address: "पूरा पता", addressPh: "मकान नं., मोहल्ला, शहर",
    wardNo: "वार्ड नंबर", wardPh: "वार्ड",
    areaBooth: "क्षेत्र / बूथ", areaPh: "क्षेत्र या बूथ",
    interested: "कार्यकर्ता बनने के इच्छुक?",
    yes: "हाँ", no: "नहीं",
    workerRole: "कार्यकर्ता भूमिका", workerRolePh: "जैसे बूथ अध्यक्ष, वार्ड प्रभारी",
    autoTime: "पंजीयन दिनांक व समय स्वतः दर्ज होगा",
    submit: "सबमिट करें", saving: "सहेजा जा रहा है…",
    footer: "आम आदमी पार्टी छत्तीसगढ़",
    invalidTitle: "लिंक मान्य नहीं है",
    errName: "कृपया नाम भरें.",
    errMobile: "कृपया सही 10 अंकों का मोबाइल नंबर भरें.",
    creditedTo: "यह पंजीयन दर्ज होगा:",
    errConstituency: "कृपया अपना विधानसभा क्षेत्र चुनें.",
    errSave: "सहेजा नहीं जा सका. कृपया दोबारा प्रयास करें.",
    errLoad: "फॉर्म नहीं खुल सका. कृपया इंटरनेट जाँचें और दोबारा प्रयास करें.",
    switchTo: "English",
  },
  en: {
    org: "Aam Aadmi Party · Chhattisgarh",
    fallbackTitle: "Voter & Worker Registration",
    constituency: "Constituency", selectConstituency: "Select your constituency…",
    savedTitle: "Registration saved!",
    savedBody: "Fill the form below to add the next person.",
    workerSavedTitle: "Registration submitted successfully",
    workerSavedBody: "Thank you. Your registration has been submitted successfully.",
    photo: "Photo", choosePhoto: "Choose Photo", changePhoto: "Change Photo", capturePhoto: "Capture Photo", retakePhoto: "Retake",
    photoHint: "JPG, PNG or WEBP · up to 5 MB", uploading: "Uploading…",
    photoTooLarge: "Photo size is too large. Please upload a smaller image.",
    photoBadType: "Please upload a JPG, JPEG, PNG, or WEBP image.",
    photoFailed: "Unable to upload photo. Please try again.",
    kbn: "Want to become a Worker?",
    wardName: "Ward Name", wardNamePh: "Ward name",
    booth: "Booth",
    errWardName: "Please enter the ward name.",
    list: "List", myVoters: "My Voters", myWorkers: "My Workers",
    backToForm: "Back to form", totalVoters: "Total Voters", totalWorkers: "Total Workers",
    noRecords: "No records yet.", listLoadErr: "Could not load the list. Please try again.",
    handledBy: "Registration handled by", logout: "Logout",
    handlerTitle: "Worker Registration", enterRegdMobile: "Enter your registered mobile number",
    generateOtp: "Generate OTP", otpVerifyTitle: "OTP Verification", enterOtp: "Enter OTP",
    verifyOtp: "Verify OTP", resendOtp: "Resend OTP", changeMobile: "Change number",
    otpSentTo: "OTP sent to:", notRegistered: "You are not registered.", addAnother: "Add another worker",
    errOtp: "Please enter the OTP.", newOtpSent: "A new OTP has been sent.",
    otpSending: "Sending OTP…", otpInvalidFb: "Invalid OTP. Please try again.",
    otpExpiredFb: "The OTP has expired. Please request a new one.",
    otpTooManyFb: "Too many attempts. Please try again later.",
    otpSendFailFb: "Unable to send OTP. Please try again.",
    verifyUnavailable: "Mobile verification is not available right now. Please try again later.",
    section1: "Registration Form",
    personType: "Person Type",
    voter: "Voter", wantsWorker: "Wants to be a Worker",
    name: "Name", namePh: "Full name",
    mobile: "Mobile Number", mobilePh: "10-digit number",
    address: "Full Address", addressPh: "House no., locality, city",
    wardNo: "Ward Number", wardPh: "Ward",
    areaBooth: "Area / Booth", areaPh: "Area or booth",
    interested: "Interested in becoming a Worker?",
    yes: "Yes", no: "No",
    workerRole: "Worker Role", workerRolePh: "e.g. Booth President, Ward In-charge",
    autoTime: "Registration date & time are recorded automatically",
    submit: "Submit", saving: "Saving…",
    footer: "Aam Aadmi Party Chhattisgarh",
    invalidTitle: "This link is not valid",
    errName: "Please enter the name.",
    errMobile: "Enter a valid 10-digit mobile number.",
    creditedTo: "This registration is credited to:",
    errConstituency: "Please select your constituency.",
    errSave: "Could not save. Please try again.",
    errLoad: "Could not open this form. Please check your internet connection and try again.",
    switchTo: "हिंदी",
  },
};

const LANG_KEY = "aap_reg_lang";

// A labelled input. One language at a time — the switch in the header changes
// the whole page, so a second line in the other language would only add noise.
function Field({ label, children, required }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-gray-800 mb-1.5">
        {label}{required ? <span className="text-red-600"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full h-12 px-3.5 rounded-xl border border-gray-300 bg-white text-[16px] text-gray-900 " +
  "placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#164FA3] focus:border-transparent";

export default function PublicRegistrationForm({ token }) {
  const [boot, setBoot] = useState(null);      // { campaign, constituencies, credited_to, defaults }
  const [loadErr, setLoadErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState("hi");

  // Person being registered. There is deliberately no collector state: who gets
  // the credit is a property of the link, not something this form collects.
  const [personType, setPersonType] = useState("voter");
  const [wantsWorker, setWantsWorker] = useState("yes"); // only on the worker branch
  const [workerRole, setWorkerRole] = useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [address, setAddress] = useState("");
  const [assemblyId, setAssemblyId] = useState("");
  const [ward, setWard] = useState("");
  const [wardName, setWardName] = useState("");
  const [areaBooth, setAreaBooth] = useState("");
  const honeypot = useRef(null);

  // "List" view — the karyakarta's own voters / workers for THIS link.
  const [listMode, setListMode] = useState(null); // null | "voter" | "worker"

  // OTP gate for a WORKER link (/r/<token>): a worker link never opens the form
  // directly — the handler (link owner) must verify their mobile first. `session`
  // is null while checking; { required:false } for the anonymous /join & drive
  // links; { required:true, authenticated, handler } for a worker link.
  const [session, setSession] = useState(token ? null : { required: false });
  useEffect(() => {
    if (!token) { setSession({ required: false }); return; }
    let alive = true;
    fetch(`/api/public/registration/${encodeURIComponent(token)}/otp/session`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { required: false }))
      .then((d) => { if (alive) setSession(d || { required: false }); })
      .catch(() => { if (alive) setSession({ required: false }); });
    return () => { alive = false; };
  }, [token]);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);          // voter add-next banner
  const [submittedWorker, setSubmittedWorker] = useState(false); // worker → success-only
  const [now, setNow] = useState(null);

  // Photo (Worker Form). `photoUrl` is the stored /uploads path sent on submit;
  // `photoPreview` is a local object URL — the anonymous form can't read /uploads
  // back (that needs a session), so the preview never depends on it.
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState("");
  const photoInput = useRef(null);
  const cameraInput = useRef(null);

  const t = STRINGS[lang];

  // Restore the language this phone last used, and keep the clock ticking for
  // the "what is about to be recorded" line (the real stamp is server-side).
  useEffect(() => {
    try { const s = localStorage.getItem(LANG_KEY); if (s === "hi" || s === "en") setLang(s); } catch { /* storage off */ }
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  function toggleLang() {
    const next = lang === "hi" ? "en" : "hi";
    setLang(next);
    try { localStorage.setItem(LANG_KEY, next); } catch { /* storage off */ }
  }

  // /join has no token; a shared link has one. Both hit the same handlers.
  const endpoint = token ? `/api/public/registration/${encodeURIComponent(token)}` : "/api/public/registration";

  const load = useCallback(async () => {
    setLoading(true); setLoadErr("");
    try {
      const url = token ? `/api/public/registration/${encodeURIComponent(token)}` : "/api/public/registration";
      const r = await fetch(url, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setLoadErr(d?.message || "This link is not valid."); setBoot(null); return; }
      setBoot(d);
      // Editable defaults for the drive (or, on a karyakarta's link, their own
      // patch) — the only thing the bootstrap carries besides the header.
      setAssemblyId((v) => v || (d.defaults?.assembly_id ? String(d.defaults.assembly_id) : ""));
      setWard((v) => v || d.defaults?.ward_number || "");
      setAreaBooth((v) => v || d.defaults?.area_booth || "");
    } catch {
      setLoadErr(STRINGS.hi.errLoad);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function resetPerson() {
    setPersonType("voter"); setWantsWorker("yes"); setWorkerRole(""); setWardName("");
    setName(""); setMobile(""); setAddress("");
    setPhotoUrl(""); setPhotoPreview(""); setPhotoErr("");
    // Constituency, ward and booth are deliberately KEPT: a karyakarta works
    // one patch, so clearing them would mean re-picking the same values for
    // every single person they register.
    setAreaBooth((v) => v);
  }

  // Upload the chosen photo to the persistent store; keep a local preview.
  async function onPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoErr("");
    if (file.size > 5 * 1024 * 1024) { setPhotoErr(t.photoTooLarge); return; }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type || "")) { setPhotoErr(t.photoBadType); return; }
    try { if (photoPreview) URL.revokeObjectURL(photoPreview); } catch { /* ignore */ }
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch("/api/public/registration/photo", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setPhotoErr(d?.message || t.photoFailed); setPhotoPreview(""); return; }
      setPhotoUrl(d.url || "");
    } catch { setPhotoErr(t.photoFailed); setPhotoPreview(""); }
    finally { setPhotoBusy(false); }
  }


  async function handlerLogout() {
    if (!token) return;
    try { await fetch(`/api/public/registration/${encodeURIComponent(token)}/otp/logout`, { method: "POST" }); } catch { /* ignore */ }
    setSession({ required: true, authenticated: false });
    setSubmittedWorker(false);
    resetPerson();
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");
    const validMobile = (v) => /^[6-9]\d{9}$/.test(String(v).replace(/\D/g, "").slice(-10));
    // The top question decides the record type: हाँ → worker, ना → voter.
    const isWorker = personType === "worker";
    if (!name.trim()) { setErr(t.errName); return; }
    if (!validMobile(mobile)) { setErr(t.errMobile); return; }
    if (!assemblyId) { setErr(t.errConstituency); return; }
    // Ward Name is mandatory only on the worker branch; a voter is never blocked
    // by it (§3, §6). Hidden worker fields are never validated.
    if (isWorker && !wardName.trim()) { setErr(t.errWardName); return; }
    if (photoBusy) { setErr(t.uploading); return; }
    if (saving) return; // guard against a double-click / repeat submit
    setSaving(true);
    try {
      const effectiveType = isWorker ? "worker" : "voter";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_type: effectiveType,
          name: name.trim(),
          mobile: mobile.trim(),
          address: address.trim(),
          assembly_id: assemblyId,
          ward_number: ward.trim(),
          ward_name: isWorker ? wardName.trim() : "",
          area_booth: areaBooth.trim(),
          worker_role: isWorker ? workerRole.trim() : "",
          photo_url: photoUrl, // photo is supported for both voter and worker
          website: honeypot.current?.value || "",
        }),
      });
      const d = await r.json().catch(() => ({}));
      // A server message (duplicate number, drive closed) is shown verbatim —
      // it carries detail the client cannot reconstruct, such as who already
      // registered that number. On failure we do NOT show success and keep the
      // form so the person can retry without losing what they typed.
      if (!r.ok) { setErr(d?.message || t.errSave); return; }
      if (effectiveType === "worker") {
        // Worker Form: the form closes into a final success-only state (§9/§11).
        setSubmittedWorker(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        // Voter entry: a karyakarta keeps adding people, so the form stays.
        setDone(true);
        resetPerson();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setErr(t.errSave);
    } finally {
      setSaving(false);
    }
  }

  const LangButton = (
    <button type="button" onClick={toggleLang}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-white/15 text-white hover:bg-white/25">
      <Languages size={14} />{t.switchTo}
    </button>
  );

  // Worker Form success-only state (§9/§11): after a successful WORKER
  // submission the entire form is gone — only this confirmation remains, and it
  // does not fall back to a blank form or allow a repeat submission.
  if (submittedWorker) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-green-50 text-green-600 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={34} />
          </div>
          <h1 className="text-xl font-bold text-gray-900">{t.workerSavedTitle}</h1>
          <p className="text-sm text-gray-600 mt-2">{t.workerSavedBody}</p>
          {/* An OTP-verified handler can add the next worker without re-auth
              (§14) — user-initiated, so the success-only state is not violated. */}
          {session?.authenticated && (
            <button type="button" onClick={() => { setSubmittedWorker(false); resetPerson(); setPersonType("worker"); }}
                    className="mt-5 h-11 px-5 rounded-xl text-white text-sm font-bold inline-flex items-center gap-2" style={{ background: BRAND }}>
              <UserPlus size={16} /> {t.addAnother}
            </button>
          )}
          <p className="text-center text-[11px] text-gray-400 mt-6">{t.footer}</p>
        </div>
      </div>
    );
  }

  // "List" view — the karyakarta's own voters / workers for THIS link, scoped
  // server-side by the link token (§18–§23).
  if (listMode) {
    return <PublicList token={token} t={t} initial={listMode} onBack={() => setListMode(null)} toggleLang={toggleLang} />;
  }

  // Still resolving whether this (worker) link needs OTP.
  if (session === null) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="animate-spin" size={30} style={{ color: ACCENT }} /></div>;
  }
  // A worker link that isn't verified yet → OTP gate, never the form (§1, §2, §8).
  if (session.required && !session.authenticated) {
    return <RegOtpGate token={token} t={t} campaignName={boot?.campaign?.name} toggleLang={toggleLang}
                       onVerified={(handler) => setSession({ required: true, authenticated: true, handler })} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin" size={30} style={{ color: ACCENT }} />
      </div>
    );
  }

  if (loadErr || !boot) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={26} />
          </div>
          <h1 className="text-lg font-bold text-gray-900">{t.invalidTitle}</h1>
          <p className="text-sm text-gray-600 mt-2">{loadErr}</p>
          <button onClick={toggleLang} className="mt-5 text-xs font-semibold text-gray-500 inline-flex items-center gap-1.5">
            <Languages size={14} />{t.switchTo}
          </button>
        </div>
      </div>
    );
  }

  const c = boot.campaign || {};

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Election details — the form's fixed header, set by the drive */}
      <header className="text-white" style={{ background: BRAND }}>
        <div className="max-w-xl mx-auto px-4 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-white/70">{t.org}</p>
              <h1 className="text-lg font-bold mt-0.5">{c.name || t.fallbackTitle}</h1>
            </div>
            {LangButton}
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-5 space-y-4 pb-24">
        {/* Who is handling this session (the OTP-verified link owner) — clearly
            distinct from the worker being added (§7, §9). */}
        {session?.authenticated && session.handler && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">{t.handledBy}</p>
              <p className="font-bold text-gray-900 truncate">{session.handler.name}</p>
              {session.handler.mobile ? <p className="text-xs text-gray-600">{session.handler.mobile}</p> : null}
            </div>
            <button type="button" onClick={handlerLogout} className="text-xs font-semibold text-blue-700 hover:underline shrink-0">{t.logout}</button>
          </div>
        )}

        {done && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 flex items-start gap-3">
            <CheckCircle2 className="text-green-600 shrink-0 mt-0.5" size={22} />
            <div>
              <p className="font-semibold text-green-900 text-sm">{t.savedTitle}</p>
              <p className="text-[13px] text-green-800 mt-0.5">{t.savedBody}</p>
            </div>
          </div>
        )}

        {/* The very first question is what the person is; everything after it is
            about them. Nothing on this page concerns who gets the credit. */}
        <form onSubmit={submit} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-gray-900">{t.section1}</h2>

          {/* Honeypot — hidden from people, irresistible to bots. */}
          <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
                 className="absolute opacity-0 h-0 w-0 -z-10 pointer-events-none" />

          {/* The very first question: do they want to become a worker? हाँ shows
              the worker fields (incl. Ward Name); ना is an ordinary voter and the
              worker-only fields stay hidden and unvalidated. */}
          <div>
            <span className="block text-sm font-semibold text-gray-800 mb-2">{t.kbn} <span className="text-red-600">*</span></span>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPersonType("worker")}
                      className={`h-14 rounded-xl border-2 text-sm font-semibold flex flex-col items-center justify-center gap-0.5 transition ${
                        personType === "worker" ? "text-white border-transparent" : "bg-white text-gray-700 border-gray-300"}`}
                      style={personType === "worker" ? { background: ACCENT } : undefined}>
                <UserPlus size={17} />{t.yes}
              </button>
              <button type="button" onClick={() => setPersonType("voter")}
                      className={`h-14 rounded-xl border-2 text-sm font-semibold flex flex-col items-center justify-center gap-0.5 transition ${
                        personType === "voter" ? "text-white border-transparent" : "bg-white text-gray-700 border-gray-300"}`}
                      style={personType === "voter" ? { background: ACCENT } : undefined}>
                <Vote size={17} />{t.no}
              </button>
            </div>
          </div>

          <Field label={t.name} required>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePh} required />
          </Field>

          <Field label={t.mobile} required>
            <input className={inputCls} value={mobile} onChange={(e) => setMobile(e.target.value)}
                   inputMode="numeric" maxLength={15} placeholder={t.mobilePh} required />
          </Field>

          <Field label={t.address}>
            <textarea className={`${inputCls} h-24 py-2.5 leading-relaxed`} value={address}
                      onChange={(e) => setAddress(e.target.value)} placeholder={t.addressPh} />
          </Field>

          {/* Constituency is chosen from the master list, never typed — free text
              would fill the reports with spelling variants of the same place. */}
          <Field label={t.constituency} required>
            <select className={inputCls} value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)} required>
              <option value="">{t.selectConstituency}</option>
              {(boot.constituencies || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>

          {/* Ward Name — worker-only and mandatory on the हाँ branch (§6). Hidden
              (and never validated) for a voter (ना). */}
          {personType === "worker" && (
            <Field label={t.wardName} required>
              <input className={inputCls} value={wardName} onChange={(e) => setWardName(e.target.value)} placeholder={t.wardNamePh} />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={t.wardNo}>
              {/* Digits only, enforced as they type and again on the server, so
                  "07", "7" and "Ward 7" cannot become three separate wards. */}
              <input className={inputCls} value={ward} onChange={(e) => setWard(e.target.value.replace(/\D/g, ""))}
                     inputMode="numeric" pattern="[0-9]*" maxLength={10} placeholder={t.wardPh} />
            </Field>
            <Field label={t.booth}>
              <input className={inputCls} value={areaBooth} onChange={(e) => setAreaBooth(e.target.value)} placeholder={t.areaPh} />
            </Field>
          </div>

          {/* Photo — for BOTH voter and worker (§16). Capture opens the device
              camera where allowed; Choose picks an existing image. Both go through
              the same upload/store path. */}
          <div>
            <span className="block text-sm font-semibold text-gray-800 mb-2">{t.photo}</span>
            <div className="flex items-center gap-3">
              {photoPreview ? (
                <img src={photoPreview} alt="" className="w-20 h-20 rounded-xl object-cover border border-gray-300 bg-white" />
              ) : (
                <div className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 bg-white flex items-center justify-center text-gray-400">
                  <ImagePlus size={24} />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <button type="button" onClick={() => cameraInput.current?.click()} disabled={photoBusy}
                          className="h-10 px-3 rounded-xl border border-gray-300 bg-white text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5 disabled:opacity-60">
                    <Camera size={15} /> {t.capturePhoto}
                  </button>
                  <button type="button" onClick={() => photoInput.current?.click()} disabled={photoBusy}
                          className="h-10 px-3 rounded-xl border border-gray-300 bg-white text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5 disabled:opacity-60">
                    {photoBusy ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}
                    {photoBusy ? t.uploading : (photoPreview ? t.changePhoto : t.choosePhoto)}
                  </button>
                </div>
                <p className="text-[11px] text-gray-500">{t.photoHint}</p>
              </div>
              {/* Camera capture vs library choose — same handler, different source. */}
              <input ref={cameraInput} type="file" accept="image/*" capture="user" className="hidden" onChange={onPhoto} />
              <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPhoto} />
            </div>
            {photoErr ? <p className="text-[12px] text-red-700 mt-1.5">{photoErr}</p> : null}
          </div>

          {/* Worker role — worker branch only (हाँ). */}
          {personType === "worker" && (
            <Field label={t.workerRole}>
              <input className={inputCls} value={workerRole} onChange={(e) => setWorkerRole(e.target.value)}
                     placeholder={t.workerRolePh} />
            </Field>
          )}

          {/* On a karyakarta's link, who the entry is credited to — the name and
              nothing else. This page is shared WITH THE PUBLIC, so the internal
              worker code and that karyakarta's running totals stay off it. */}
          {boot.credited_to ? (
            <p className="text-[12px] text-gray-600 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
              {t.creditedTo} <span className="font-semibold text-gray-900">{boot.credited_to}</span>
            </p>
          ) : null}

          {/* Registration date/time are recorded automatically by the server. */}
          <p className="text-[12px] text-gray-500">
            {t.autoTime}
            {now ? ` — ${now.toLocaleDateString("en-IN")} ${now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}
          </p>

          {err ? <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{err}</p> : null}

          <button type="submit" disabled={saving}
                  className="w-full min-h-[52px] rounded-xl text-white text-base font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                  style={{ background: BRAND }}>
            {saving ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={19} />}
            {saving ? t.saving : t.submit}
          </button>
        </form>

        {/* View the list of people already registered through this link. */}
        <button type="button" onClick={() => setListMode("voter")}
                className="w-full min-h-[48px] rounded-xl border-2 border-gray-300 bg-white text-gray-800 text-sm font-bold flex items-center justify-center gap-2 hover:bg-gray-50">
          <ListIcon size={18} /> {t.list}
        </button>

        <p className="text-center text-[11px] text-gray-400 pb-4">{t.footer}</p>
      </main>
    </div>
  );
}

// The link's own list, with two tabs (मेरे वोटर / मेरे कार्यकर्ता). The rows come
// from a token-scoped endpoint: the server derives ownership from the link and
// returns only this link's people, so no client-supplied id can widen the scope.
function PublicList({ token, t, initial, onBack, toggleLang }) {
  const [type, setType] = useState(initial === "worker" ? "worker" : "voter");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr("");
    const base = token ? `/api/public/registration/${encodeURIComponent(token)}` : "/api/public/registration";
    fetch(`${base}?list=${type}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => { if (!alive) return; setRows(d.people || []); setTotal(d.total || 0); })
      .catch(() => { if (alive) setErr(t.listLoadErr); })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [token, type, t.listLoadErr]);

  const Tab = ({ value, label }) => (
    <button type="button" onClick={() => setType(value)}
            className={`flex-1 h-11 rounded-xl border-2 text-sm font-semibold ${type === value ? "text-white border-transparent" : "bg-white text-gray-700 border-gray-300"}`}
            style={type === value ? { background: ACCENT } : undefined}>
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="text-white" style={{ background: BRAND }}>
        <div className="max-w-xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/90 hover:text-white">
            <ArrowLeft size={16} /> {t.backToForm}
          </button>
          <button type="button" onClick={toggleLang} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-white/15 text-white hover:bg-white/25">
            <Languages size={14} />{t.switchTo}
          </button>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-5 space-y-4">
        <div className="flex gap-2">
          <Tab value="voter" label={t.myVoters} />
          <Tab value="worker" label={t.myWorkers} />
        </div>

        <div className="flex items-baseline justify-between px-1">
          <span className="text-sm font-semibold text-gray-700">{type === "worker" ? t.totalWorkers : t.totalVoters}</span>
          <span className="text-2xl font-bold" style={{ color: BRAND }}>{total}</span>
        </div>

        {loading ? (
          <div className="py-14 flex justify-center"><Loader2 className="animate-spin" size={26} style={{ color: ACCENT }} /></div>
        ) : err ? (
          <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{err}</div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center text-gray-400 text-sm">{t.noRecords}</div>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3">
                <span className="w-6 text-center text-xs font-bold text-gray-400">{i + 1}</span>
                <ListThumb src={r.photo_url} name={r.name} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-gray-900 truncate">{r.name}</div>
                  <div className="text-xs text-gray-500">{r.mobile || "—"}{r.assembly_name ? ` · ${r.assembly_name}` : ""}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-center text-[11px] text-gray-400 pb-4">{t.footer}</p>
      </main>
    </div>
  );
}

function ListThumb({ src, name }) {
  const [ok, setOk] = useState(true);
  if (src && ok) return <img src={src} alt={name || ""} loading="lazy" className="w-11 h-11 rounded-full object-cover border border-gray-200 bg-white shrink-0" onError={() => setOk(false)} />;
  return <div className="w-11 h-11 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-[#164FA3] font-bold shrink-0">{String(name || "?").trim().charAt(0).toUpperCase() || "?"}</div>;
}

// The OTP gate shown before a WORKER link's form. Two steps: mobile → OTP. The
// mobile is the LINK OWNER's; the backend validates it against reg_workers and
// sends the OTP only to a registered handler (§2–§5).
const OTP_LEN = 6; // Firebase phone-auth codes are always 6 digits.

function RegOtpGate({ token, t, campaignName, toggleLang, onVerified }) {
  const [step, setStep] = useState("mobile"); // mobile | otp
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [masked, setMasked] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [fbReady, setFbReady] = useState(null); // null=loading | true | false(unavailable)
  const authRef = useRef(null);
  const confirmRef = useRef(null);   // Firebase confirmationResult
  const verifierRef = useRef(null);  // RecaptchaVerifier

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // Load the Firebase web config and initialise the SDK — client-side only, and
  // only the public (non-secret) config, fetched from our backend.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/public/firebase-config`);
        const cfg = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!cfg?.configured) { setFbReady(false); return; }
        const { initializeApp, getApps, getApp } = await import("firebase/app");
        const { getAuth } = await import("firebase/auth");
        const app = getApps().length ? getApp() : initializeApp({
          apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId,
          appId: cfg.appId, messagingSenderId: cfg.messagingSenderId,
        });
        authRef.current = getAuth(app);
        if (alive) setFbReady(true);
      } catch { if (alive) setFbReady(false); }
    })();
    return () => { alive = false; try { verifierRef.current?.clear?.(); } catch { /* noop */ } };
  }, []);

  const base = `/api/public/registration/${encodeURIComponent(token)}/otp`;
  const post = (path, body) => fetch(`${base}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  // Map a Firebase auth error code → a friendly bilingual message (§13).
  function fbMessage(code) {
    switch (code) {
      case "auth/invalid-phone-number":
      case "auth/missing-phone-number": return t.errMobile;
      case "auth/invalid-verification-code": return t.otpInvalidFb;
      case "auth/code-expired": return t.otpExpiredFb;
      case "auth/too-many-requests":
      case "auth/quota-exceeded": return t.otpTooManyFb;
      default: return t.otpSendFailFb;
    }
  }

  // A fresh invisible reCAPTCHA verifier per send avoids "already rendered" reuse
  // issues; Firebase's anti-aboise flow is never bypassed (§7).
  async function startFirebase(e164) {
    const { RecaptchaVerifier, signInWithPhoneNumber } = await import("firebase/auth");
    try { verifierRef.current?.clear?.(); } catch { /* noop */ }
    verifierRef.current = new RecaptchaVerifier(authRef.current, "reg-recaptcha", { size: "invisible" });
    confirmRef.current = await signInWithPhoneNumber(authRef.current, e164, verifierRef.current);
  }

  async function requestOtp(e) {
    e?.preventDefault?.();
    setErr(""); setInfo("");
    const ten = mobile.replace(/\D/g, "").slice(-10);
    if (ten.length !== 10) { setErr(t.errMobile); return; }
    if (fbReady === false) { setErr(t.verifyUnavailable); return; }
    if (fbReady == null) { setErr(t.otpSending); return; } // config still loading
    setBusy(true);
    try {
      // 1) Owner pre-check (NO SMS) → instant "not registered" and no wasted quota.
      const r = await post("request", { mobile });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || t.errSave); return; }
      // 2) Firebase sends + will verify the SMS to the confirmed E.164 number.
      await startFirebase(d.e164 || `+91${ten}`);
      setMasked(d.phone || ""); setCooldown(30); setStep("otp");
    } catch (e2) {
      setErr(fbMessage(e2?.code));
    } finally { setBusy(false); }
  }
  async function verifyOtp(e) {
    e?.preventDefault?.();
    setErr(""); setInfo("");
    if (!otp.trim()) { setErr(t.errOtp); return; }
    if (!confirmRef.current) { setStep("mobile"); setErr(t.otpExpiredFb); return; }
    setBusy(true);
    try {
      // Firebase verifies the code; we then hand the ID token to our backend,
      // which checks it and the owner rule. We never compare the OTP ourselves.
      const cred = await confirmRef.current.confirm(otp.trim());
      const idToken = await cred.user.getIdToken();
      const r = await post("firebase", { idToken });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || t.errSave); return; }
      onVerified(d.handler || null);
    } catch (e2) {
      setErr(fbMessage(e2?.code));
    } finally { setBusy(false); }
  }
  async function resend() {
    if (cooldown > 0 || busy) return;
    setErr(""); setInfo(""); setBusy(true);
    try {
      const ten = mobile.replace(/\D/g, "").slice(-10);
      await startFirebase(`+91${ten}`);
      setInfo(t.newOtpSent); setCooldown(30);
    } catch (e2) { setErr(fbMessage(e2?.code)); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="text-white" style={{ background: BRAND }}>
        <div className="max-w-md mx-auto px-4 py-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-white/70">{t.org}</p>
            <h1 className="text-lg font-bold mt-0.5">{campaignName || t.handlerTitle}</h1>
          </div>
          <button type="button" onClick={toggleLang} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-white/15 text-white hover:bg-white/25">
            <Languages size={14} />{t.switchTo}
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-6">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          {step === "mobile" ? (
            <form onSubmit={requestOtp} className="space-y-4">
              <h2 className="text-base font-bold text-gray-900">{t.handlerTitle}</h2>
              <p className="text-sm text-gray-500 -mt-2">{t.enterRegdMobile}</p>
              <div className="flex items-center rounded-xl border border-gray-300 overflow-hidden focus-within:ring-2 focus-within:ring-[#164FA3]">
                <span className="px-3 h-12 flex items-center text-sm text-gray-500 bg-gray-50 border-r border-gray-300">+91</span>
                <input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="numeric" autoFocus
                       placeholder={t.mobilePh} className="flex-1 h-12 px-3 text-[16px] outline-none" />
              </div>
              {err ? <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{err}</p> : null}
              <button type="submit" disabled={busy} className="w-full min-h-[52px] rounded-xl text-white text-base font-bold flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: BRAND }}>
                {busy ? <Loader2 className="animate-spin" size={20} /> : null} {t.generateOtp}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyOtp} className="space-y-4">
              <button type="button" onClick={() => { setStep("mobile"); setOtp(""); setErr(""); }} className="text-xs text-gray-400 hover:text-gray-600 inline-flex items-center gap-1"><ArrowLeft size={13} /> {t.changeMobile}</button>
              <h2 className="text-base font-bold text-gray-900">{t.otpVerifyTitle}</h2>
              <p className="text-sm text-gray-500 -mt-2">{t.otpSentTo} <span className="font-semibold text-gray-700">{masked}</span></p>
              <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_LEN))} inputMode="numeric" autoFocus
                     maxLength={OTP_LEN} placeholder={"•".repeat(OTP_LEN)}
                     className="w-full h-12 rounded-xl border border-gray-300 text-center text-lg tracking-[0.5em] font-semibold outline-none focus:ring-2 focus:ring-[#164FA3]" />
              {err ? <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{err}</p> : null}
              {info ? <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">{info}</p> : null}
              <button type="submit" disabled={busy} className="w-full min-h-[52px] rounded-xl text-white text-base font-bold flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: BRAND }}>
                {busy ? <Loader2 className="animate-spin" size={20} /> : null} {t.verifyOtp}
              </button>
              <div className="text-center text-sm text-gray-500">
                <button type="button" onClick={resend} disabled={cooldown > 0 || busy} className="font-semibold text-[#164FA3] disabled:text-gray-400">
                  {t.resendOtp}{cooldown > 0 ? ` (${cooldown}s)` : ""}
                </button>
              </div>
            </form>
          )}
        </div>
        {/* Invisible reCAPTCHA host for Firebase phone auth (required, never bypassed). */}
        <div id="reg-recaptcha" />
        <p className="text-center text-[11px] text-gray-400 mt-4">{t.footer}</p>
      </main>
    </div>
  );
}
