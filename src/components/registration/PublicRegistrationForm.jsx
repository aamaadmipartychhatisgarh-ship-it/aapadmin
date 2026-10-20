"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Languages, Loader2, ShieldAlert, UserPlus, Vote, ImagePlus, Camera, List as ListIcon, ArrowLeft } from "lucide-react";
import { RatingScale } from "@/components/KaryakartaRating";

// The registration form. It is OTP-gated at EVERY entry — there is no anonymous
// access — and who ends up credited is the signed-in karyakarta, derived from the
// session server-side, never a field the form collects:
//   • /join — the shared drive link. A registered karyakarta of the live drive
//     signs in with their mobile + OTP; their registrations are credited to them.
//   • /r/<token> — a link generated for one karyakarta and shared by them; its
//     owner signs in the same way and every registration through it is theirs.
// So the form asks nothing about who is collecting. It cannot: there is no field
// to put a name in, which is also why nobody can claim someone else's work.
//
// After OTP the person picks Worker or Voter, then fills that person's details.
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
    fallbackTitle: "कार्यकर्ता एवं मतदाता पंजीयन",
    constituency: "विधानसभा क्षेत्र", selectConstituency: "अपना क्षेत्र चुनें…",
    savedTitle: "पंजीयन सफल!",
    savedBody: "अगला व्यक्ति जोड़ने के लिए नीचे फॉर्म भरें.",
    workerSavedTitle: "पंजीयन सफलतापूर्वक जमा हुआ",
    workerSavedBody: "धन्यवाद. आपका पंजीयन सफलतापूर्वक जमा हो गया है.",
    photo: "फोटो", choosePhoto: "फोटो चुनें", changePhoto: "फोटो बदलें", capturePhoto: "फोटो खींचें", retakePhoto: "दोबारा खींचें",
    photoHint: "JPG, PNG या WEBP · अधिकतम 5 MB", uploading: "अपलोड हो रहा है…",
    photoFromContacts: "यह फोटो Contacts से स्वतः ली गई है",
    workerId: "कार्यकर्ता आईडी", contactId: "कॉन्टैक्ट आईडी", matchedFromContacts: "Contacts से मिलान",
    photoTooLarge: "फोटो का आकार बहुत बड़ा है. कृपया छोटी छवि अपलोड करें.",
    photoBadType: "कृपया JPG, JPEG, PNG या WEBP छवि अपलोड करें.",
    photoFailed: "फोटो अपलोड नहीं हो सकी. कृपया दोबारा प्रयास करें.",
    blockName: "ब्लॉक का नाम", selectBlock: "ब्लॉक चुनें…",
    selectAssemblyFirst: "पहले विधानसभा क्षेत्र चुनें",
    noBlocks: "इस विधानसभा के लिए कोई ब्लॉक उपलब्ध नहीं",
    loadingBlocks: "ब्लॉक लोड हो रहे हैं…",
    errBlockName: "कृपया ब्लॉक चुनें.",
    blocksLoadErr: "ब्लॉक लोड नहीं हो सके. कृपया दोबारा प्रयास करें.",
    list: "सूची", myVoters: "मेरे वोटर", myWorkers: "मेरे कार्यकर्ता",
    backToForm: "फॉर्म पर वापस जाएँ", totalVoters: "कुल वोटर", totalWorkers: "कुल कार्यकर्ता",
    noRecords: "अभी तक कोई रिकॉर्ड नहीं.", listLoadErr: "सूची लोड नहीं हो सकी. कृपया दोबारा प्रयास करें.",
    handledBy: "पंजीयन कर रहे हैं", logout: "लॉगआउट",
    handlerTitle: "कार्यकर्ता पंजीयन", enterRegdMobile: "अपना पंजीकृत मोबाइल नंबर दर्ज करें",
    loginTitle: "कार्यकर्ता लॉगिन", loginHint: "अपने इन-चार्ज से मिला उपयोगकर्ता नाम और पासवर्ड दर्ज करें.",
    usernameLabel: "उपयोगकर्ता नाम (आपका नाम)", usernamePh: "आपका नाम", passwordLabel: "पासवर्ड", passwordPh: "पासवर्ड",
    signIn: "साइन इन करें", signingIn: "साइन इन हो रहा है…",
    errLogin: "गलत उपयोगकर्ता नाम या पासवर्ड.", errLoginFields: "कृपया उपयोगकर्ता नाम और पासवर्ड भरें.",
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
    voter: "मतदाता",
    worker: "कार्यकर्ता",
    chooseTypeTitle: "आप किसका पंजीयन करना चाहते हैं?",
    chooseTypeSub: "आरंभ करने के लिए प्रकार चुनें",
    workerDesc: "पार्टी कार्यकर्ता के रूप में पंजीयन करें",
    voterDesc: "मतदाता के रूप में पंजीयन करें",
    changeType: "प्रकार बदलें",
    name: "नाम", namePh: "पूरा नाम",
    mobile: "मोबाइल नंबर", mobilePh: "10 अंकों का नंबर",
    address: "पूरा पता", addressPh: "मकान नं., मोहल्ला, शहर",
    workerRating: "कार्यकर्ता रेटिंग", workerRatingHint: "1 से 10 तक रेटिंग चुनें",
    autoTime: "पंजीयन दिनांक व समय स्वतः दर्ज होगा",
    submit: "सबमिट करें", saving: "सहेजा जा रहा है…",
    footer: "आम आदमी पार्टी छत्तीसगढ़",
    invalidTitle: "लिंक मान्य नहीं है",
    errName: "कृपया नाम भरें.",
    errMobile: "कृपया सही 10 अंकों का मोबाइल नंबर भरें.",
    creditedTo: "यह पंजीयन दर्ज होगा:",
    sendOtp: "OTP भेजें", resendOtp: "दोबारा भेजें",
    otpSent: "आपके नंबर पर 6 अंकों का कोड भेजा गया है.",
    otpLabel: "OTP कोड", otpPh: "6 अंकों का कोड",
    verify: "जाँचें", verified: "नंबर सत्यापित ✓",
    verifyFirst: "कृपया पहले मोबाइल नंबर सत्यापित करें.",
    changeNumber: "नंबर बदलें",
    errConstituency: "कृपया अपना विधानसभा क्षेत्र चुनें.",
    errSave: "सहेजा नहीं जा सका. कृपया दोबारा प्रयास करें.",
    errLoad: "फॉर्म नहीं खुल सका. कृपया इंटरनेट जाँचें और दोबारा प्रयास करें.",
    switchTo: "English",
  },
  en: {
    org: "Aam Aadmi Party · Chhattisgarh",
    fallbackTitle: "Worker & Voter Registration",
    constituency: "Constituency", selectConstituency: "Select your constituency…",
    savedTitle: "Registration saved!",
    savedBody: "Fill the form below to add the next person.",
    workerSavedTitle: "Registration submitted successfully",
    workerSavedBody: "Thank you. Your registration has been submitted successfully.",
    photo: "Photo", choosePhoto: "Choose Photo", changePhoto: "Change Photo", capturePhoto: "Capture Photo", retakePhoto: "Retake",
    photoHint: "JPG, PNG or WEBP · up to 5 MB", uploading: "Uploading…",
    photoFromContacts: "Photo taken automatically from Contacts",
    workerId: "Worker ID", contactId: "Contact ID", matchedFromContacts: "Matched from Contacts",
    photoTooLarge: "Photo size is too large. Please upload a smaller image.",
    photoBadType: "Please upload a JPG, JPEG, PNG, or WEBP image.",
    photoFailed: "Unable to upload photo. Please try again.",
    blockName: "Block Name", selectBlock: "Select a Block…",
    selectAssemblyFirst: "Select a Vidhan Sabha first",
    noBlocks: "No Blocks available for this Vidhan Sabha",
    loadingBlocks: "Loading Blocks…",
    errBlockName: "Please select a Block.",
    blocksLoadErr: "Could not load Blocks. Please try again.",
    list: "List", myVoters: "My Voters", myWorkers: "My Workers",
    backToForm: "Back to form", totalVoters: "Total Voters", totalWorkers: "Total Workers",
    noRecords: "No records yet.", listLoadErr: "Could not load the list. Please try again.",
    handledBy: "Registration handled by", logout: "Logout",
    handlerTitle: "Worker Registration", enterRegdMobile: "Enter your registered mobile number",
    loginTitle: "Karyakarta Login", loginHint: "Enter the username and password given to you by your in-charge.",
    usernameLabel: "Username (your name)", usernamePh: "Your name", passwordLabel: "Password", passwordPh: "Password",
    signIn: "Sign In", signingIn: "Signing in…",
    errLogin: "Incorrect username or password.", errLoginFields: "Please enter your username and password.",
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
    voter: "Voter",
    worker: "Worker",
    chooseTypeTitle: "What would you like to register?",
    chooseTypeSub: "Choose a type to begin",
    workerDesc: "Register as a party worker",
    voterDesc: "Register as a voter",
    changeType: "Change type",
    name: "Name", namePh: "Full name",
    mobile: "Mobile Number", mobilePh: "10-digit number",
    address: "Full Address", addressPh: "House no., locality, city",
    workerRating: "Karyakarta Rating", workerRatingHint: "Select a rating from 1 to 10",
    autoTime: "Registration date & time are recorded automatically",
    submit: "Submit", saving: "Saving…",
    footer: "Aam Aadmi Party Chhattisgarh",
    invalidTitle: "This link is not valid",
    errName: "Please enter the name.",
    errMobile: "Enter a valid 10-digit mobile number.",
    creditedTo: "This registration is credited to:",
    sendOtp: "Send OTP", resendOtp: "Resend",
    otpSent: "A 6-digit code has been sent to this number.",
    otpLabel: "OTP code", otpPh: "6-digit code",
    verify: "Verify", verified: "Number verified ✓",
    verifyFirst: "Please verify the mobile number first.",
    changeNumber: "Change number",
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

// Arvind Kejriwal Ji's photo for the form's top navbar — the EXACT same asset the
// Dashboard uses (public/kejriwal_new.png), reused so the leader photo stays
// consistent across the app. A rounded white chip keeps it clean on the brand
// header; if the image can't load it simply hides (no broken-image icon).
function LeaderPhoto() {
  return (
    <span className="shrink-0 inline-flex items-center justify-center h-11 w-11 sm:h-12 sm:w-12 rounded-full bg-white/95 overflow-hidden ring-1 ring-white/40">
      <img src="/kejriwal_new.png" alt="Arvind Kejriwal" className="h-full w-full object-contain"
        onError={(e) => { e.currentTarget.parentElement.style.display = "none"; }} />
    </span>
  );
}

// The signed-in DATA COLLECTOR's identity in the form's top bar: their own profile
// photo (from their user/Contact record, via the authenticated session) beside
// their username — never the worker being added (§7). A compact circular avatar;
// initials placeholder when they have no photo (§9). Logout clears it (§8/§11).
function HandlerBadge({ handler, onLogout, t }) {
  const name = handler?.name || "";
  // Fall back to initials only if the photo genuinely fails to load — a resolved
  // Contact photo must not show as a broken image (§6). `photo_url` re-arms the guard.
  const [ok, setOk] = useState(true);
  useEffect(() => { setOk(true); }, [handler?.photo_url]);
  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        {handler?.photo_url && ok ? (
          <img src={handler.photo_url} alt={name} className="w-10 h-10 rounded-full object-cover border border-white shadow-sm shrink-0" onError={() => setOk(false)} />
        ) : (
          <span className="w-10 h-10 rounded-full bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center font-bold shrink-0">
            {(name || "?").trim().charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">{t.handledBy}</p>
          <p className="font-bold text-gray-900 truncate">{name}</p>
          {handler?.mobile ? <p className="text-xs text-gray-600 truncate">{handler.mobile}</p> : null}
        </div>
      </div>
      <button type="button" onClick={onLogout} className="text-xs font-semibold text-blue-700 hover:underline shrink-0">{t.logout}</button>
    </div>
  );
}

export default function PublicRegistrationForm({ token }) {
  const [boot, setBoot] = useState(null);      // { campaign, constituencies, credited_to, defaults }
  const [loadErr, setLoadErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState("hi");

  // Person being registered. There is deliberately no collector state: who gets
  // the credit is a property of the link, not something this form collects.
  const [personType, setPersonType] = useState("voter");
  // The FIRST step: what is being registered — Worker or Voter. It gates the
  // whole form (no field is shown until it is chosen), so the record type is a
  // deliberate up-front choice, not a buried Yes/No. Kept in sessionStorage so a
  // refresh mid-session cannot silently flip Worker↔Voter (§7); browser
  // back/forward never touch it because it is pure client state, not the URL (§8).
  const [regType, setRegType] = useState(null); // null | "worker" | "voter"
  const [workerRating, setWorkerRating] = useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  // Mobile verification. `otpFor` records WHICH number was proven, so editing
  // the number after verifying silently invalidates it instead of letting a
  // verified 9876543210 carry a registration for 9000000000.
  const [otpStage, setOtpStage] = useState("idle"); // idle | sent | done
  const [otpCode, setOtpCode] = useState("");
  const [otpFor, setOtpFor] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpNote, setOtpNote] = useState("");
  const [address, setAddress] = useState("");
  const [assemblyId, setAssemblyId] = useState("");
  // Block (formerly Ward Name) — a dropdown DEPENDENT on the selected Vidhan Sabha.
  // blockId is the chosen Block's id; `blocks` is the current assembly's mapped list
  // fetched from the Political Location master (never hardcoded, never all-blocks
  // filtered on the client).
  const [blockId, setBlockId] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [blocksErr, setBlocksErr] = useState("");
  const honeypot = useRef(null);

  // "List" view — the karyakarta's own voters / workers for THIS link.
  const [listMode, setListMode] = useState(null); // null | "voter" | "worker"

  // OTP gate. EVERY entry point is OTP-gated now — the form never opens directly,
  // not even /join. `session` is null while checking, then
  // { required:true, authenticated:false } → show the OTP gate, or
  // { required:true, authenticated:true, handler } → the signed-in karyakarta.
  // A worker link authenticates its own owner; /join and drive links authenticate
  // any registered karyakarta of that drive. The endpoints differ only in path:
  // tokenless /join uses …/registration/join/*, a token uses …/<token>/otp/*.
  const otpBase = token ? `/api/public/registration/${encodeURIComponent(token)}/otp` : `/api/public/registration/join`;
  const [session, setSession] = useState(null);
  useEffect(() => {
    let alive = true;
    const url = `${otpBase}/session`;
    // The authenticated state lives in an HTTP-only cookie the server verifies,
    // so this GET only READS it back after a refresh/remount — it never mints or
    // clears a session. Because it is authoritative, a transient network or API
    // failure must NOT be turned into a state: collapsing to { required:false }
    // would silently downgrade a logged-in handler to "anonymous" over one bad
    // request (§8, §9). Instead we keep the loader up and RETRY with capped
    // backoff, so a page refresh restores the exact session the cookie still
    // holds the moment the endpoint answers, and only an explicit Logout (or the
    // cookie's own expiry) ever ends it. A truly invalid/drive/general token is
    // an OK 200 response ({ required:false }), so it resolves immediately — only
    // real failures retry.
    let attempt = 0;
    (async () => {
      while (alive) {
        try {
          const r = await fetch(url, { cache: "no-store" });
          if (r.ok) {
            const d = await r.json().catch(() => null);
            if (alive && d) { setSession(d); return; }
          }
        } catch { /* transient — fall through to retry, never guess a state */ }
        attempt += 1;
        await new Promise((res) => setTimeout(res, Math.min(1000 * 2 ** attempt, 15000)));
      }
    })();
    return () => { alive = false; };
  }, [otpBase]);

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

  // The person-being-added's EXISTING photo, pulled from the Contacts module by the
  // mobile they type (§ worker photo). Contacts is the source of truth: this is the
  // SAME photo already stored against that Contact — resolved by mobile only, never
  // by name — shown here so the collector never re-uploads a photo that exists. It
  // is read-only and live-linked (a manual capture/upload still overrides it), and
  // it resets for every new person so one worker's photo never lingers onto the next.
  const [contactPhoto, setContactPhoto] = useState(null); // { photo_url, name } | null

  const t = STRINGS[lang];

  // Per-tab, per-link key: /join and each /r/<token> keep their own choice, so a
  // choice made on one link never leaks into another opened in the same tab.
  const REGTYPE_KEY = `aap_reg_type_${token || "join"}`;

  // Restore the language this phone last used, and keep the clock ticking for
  // the "what is about to be recorded" line (the real stamp is server-side).
  useEffect(() => {
    try { const s = localStorage.getItem(LANG_KEY); if (s === "hi" || s === "en") setLang(s); } catch { /* storage off */ }
    // Restore a type chosen earlier in this session so a refresh keeps the same
    // form (§7). The data fetch below keeps the loader up until it resolves, so
    // this synchronous restore lands before the selection/form choice is drawn.
    try { const rt = sessionStorage.getItem(REGTYPE_KEY); if (rt === "worker" || rt === "voter") { setRegType(rt); setPersonType(rt); } } catch { /* storage off */ }
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
      // Editable default for the drive (or, on a karyakarta's link, their own
      // patch) — the only thing the bootstrap carries besides the header. The
      // link's own ward/area still ride along server-side on submit; they are
      // just no longer fields on this form.
      setAssemblyId((v) => v || (d.defaults?.assembly_id ? String(d.defaults.assembly_id) : ""));
    } catch {
      setLoadErr(STRINGS.hi.errLoad);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Dependent Block dropdown: whenever the selected Vidhan Sabha changes, drop any
  // previously chosen Block (so a Block from the old assembly can never linger) and
  // fetch ONLY that assembly's Blocks from the Political Location master. No assembly
  // → empty list + disabled dropdown. A load failure surfaces a retryable error and
  // leaves the dropdown empty rather than guessing.
  useEffect(() => {
    setBlockId("");
    if (!assemblyId) { setBlocks([]); setBlocksErr(""); setBlocksLoading(false); return; }
    let alive = true;
    setBlocksLoading(true); setBlocksErr("");
    fetch(`/api/public/registration/assemblies/${encodeURIComponent(assemblyId)}/blocks`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => { if (alive) setBlocks(Array.isArray(d.blocks) ? d.blocks : []); })
      .catch(() => { if (alive) { setBlocks([]); setBlocksErr(STRINGS[lang].blocksLoadErr); } })
      .finally(() => { if (alive) setBlocksLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assemblyId]);

  function resetPerson() {
    // Block selection is cleared for the next person; the Block LIST is kept because
    // the constituency is retained (below), so the same assembly's blocks stay ready.
    setPersonType("voter"); setWorkerRating(""); setBlockId("");
    setName(""); setMobile(""); setAddress("");
    setPhotoUrl(""); setPhotoPreview(""); setPhotoErr(""); setContactPhoto(null);
    setOtpStage("idle"); setOtpCode(""); setOtpFor(""); setOtpNote("");
    // Constituency is deliberately KEPT: a karyakarta works one patch, so
    // clearing it would mean re-picking the same value for every person they
    // register.
  }

  // First-step choice: pick Worker or Voter, then the matching form opens. The
  // choice sets the record type directly and is remembered for this session.
  function chooseType(next) {
    setRegType(next);
    setPersonType(next);
    setErr("");
    try { sessionStorage.setItem(REGTYPE_KEY, next); } catch { /* storage off */ }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Go back to the selection screen (user-initiated) and clear the person fields
  // so nothing typed under one type carries into the other.
  function backToSelection() {
    setRegType(null);
    try { sessionStorage.removeItem(REGTYPE_KEY); } catch { /* storage off */ }
    resetPerson();
    setErr("");
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    try { await fetch(`${otpBase}/logout`, { method: "POST" }); } catch { /* ignore */ }
    setSession({ required: true, authenticated: false });
    setSubmittedWorker(false);
    resetPerson();
    // A new handler may log in next — make them choose the type afresh.
    setRegType(null);
    try { sessionStorage.removeItem(REGTYPE_KEY); } catch { /* ignore */ }
  }

  // Verification is required only when the drive says so AND a provider is
  // configured; the bootstrap already ANDs those two, so the form never shows a
  // step nobody could complete.
  const otpRequired = !!boot?.otp_required;
  const mobileDigits = mobile.replace(/\D/g, "").slice(-10);
  const validMobile = (v) => /^[6-9]\d{9}$/.test(String(v).replace(/\D/g, "").slice(-10));
  // Editing the number after proving it drops the proof — otherwise a verified
  // number could carry a registration for a different one.
  const otpDone = otpStage === "done" && otpFor === mobileDigits;

  // Resolve the entered person's Contacts photo as their mobile is typed. It only
  // runs for a signed-in collector (the lookup is session-gated) and once the number
  // is a full valid 10 digits; any change to the number invalidates the previous
  // match immediately (the cleanup drops the in-flight/late response), so one
  // person's photo can never carry onto the next. Missing/unknown → null, and the
  // form falls back to its placeholder + manual capture. The match is by mobile, so
  // it applies to whoever is being added (worker or voter) — never by name.
  useEffect(() => {
    if (!session?.authenticated) { setContactPhoto(null); return; }
    if (!validMobile(mobile)) { setContactPhoto(null); return; }
    let alive = true;
    const ten = mobile.replace(/\D/g, "").slice(-10);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/public/registration/join/worker-photo?mobile=${encodeURIComponent(ten)}`, { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        // Tag the match with the exact number it belongs to; the render only trusts
        // it while it still matches the field, so a resolved photo can never linger
        // onto a different number (§8).
        //
        // A match is kept even when it carries NO photo (an identified person whose
        // Contact has none): the header then shows the default initials placeholder
        // beside their real name and ID (§9), which confirms the right person was
        // matched, instead of showing nothing at all. It is never another worker's
        // photo — photo_url is simply null and the capture buttons stay available.
        if (alive) setContactPhoto(d && (d.photo_url || d.name) ? { ...d, forKey: ten } : null);
      } catch { if (alive) setContactPhoto(null); }
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [mobile, session?.authenticated]);

  // The matched Contact photo, trusted ONLY while it still belongs to the number
  // currently in the field. Everything on screen (the photo slot, the worker header
  // card and the top-bar chip) reads this, so switching from Worker A to Worker B
  // never shows A's photo for B — the moment the number differs, this is null until
  // B's own match resolves.
  const workerPhoto = contactPhoto && contactPhoto.forKey === mobileDigits ? contactPhoto : null;

  async function sendCode() {
    setErr(""); setOtpNote("");
    if (!validMobile(mobile)) { setErr(t.errMobile); return; }
    setOtpBusy(true);
    try {
      const r = await fetch("/api/public/registration/otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", mobile: mobileDigits, token: token || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d?.message || t.errSave); return; }
      setOtpStage("sent"); setOtpCode(""); setOtpNote(t.otpSent);
    } catch { setErr(t.errSave); }
    finally { setOtpBusy(false); }
  }

  async function verifyCode() {
    setErr(""); setOtpNote("");
    setOtpBusy(true);
    try {
      const r = await fetch("/api/public/registration/otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", mobile: mobileDigits, code: otpCode, token: token || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d?.message || t.errSave); return; }
      setOtpStage("done"); setOtpFor(mobileDigits); setOtpNote("");
    } catch { setErr(t.errSave); }
    finally { setOtpBusy(false); }
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");
    // The top question decides the record type: हाँ → worker, ना → voter.
    const isWorker = personType === "worker";
    if (!name.trim()) { setErr(t.errName); return; }
    if (!validMobile(mobile)) { setErr(t.errMobile); return; }
    if (!assemblyId) { setErr(t.errConstituency); return; }
    // Ward Name is mandatory only on the worker branch; a voter is never blocked
    // by it (§3, §6). Hidden worker fields are never validated.
    if (isWorker && !blockId) { setErr(t.errBlockName); return; }
    if (photoBusy) { setErr(t.uploading); return; }
    // The registrant's own number must be proven when the drive demands it.
    if (otpRequired && !otpDone) { setErr(t.verifyFirst); return; }
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
          // Block (Assembly-dependent). The id is validated server-side against the
          // selected assembly; the backend resolves and stores the Block's name.
          block_id: isWorker ? blockId : "",
          worker_rating: isWorker && workerRating ? Number(workerRating) : null,
          // Manual capture/upload wins; otherwise the photo already stored against
          // this person's Contact (same URL, not a re-upload/duplicate) so the saved
          // record is never left photo-less when Contacts already has one.
          // Photo belongs to the Karykarta/Worker section only — a Voter never
          // carries one, even if some photo state lingers from a prior worker entry.
          photo_url: isWorker ? (photoUrl || workerPhoto?.photo_url || "") : "",
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

  // Still resolving the session from the server-verified cookie.
  if (session === null) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="animate-spin" size={30} style={{ color: ACCENT }} /></div>;
  }
  // Not signed in yet → the gate, never the form (there is no anonymous access).
  // The COMMON link (/join, no token) uses a username + password login. A legacy
  // per-worker link (/r/<token>) keeps its OTP gate for backward compatibility.
  if (session.required && !session.authenticated) {
    const onAuthed = (handler) => setSession({ required: true, authenticated: true, handler });
    return token
      ? <RegOtpGate base={otpBase} t={t} campaignName={boot?.campaign?.name} toggleLang={toggleLang} onVerified={onAuthed} />
      : <RegLoginGate t={t} campaignName={boot?.campaign?.name} toggleLang={toggleLang} onLoggedIn={onAuthed} />;
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

  // STEP 1 — the first thing shown once the link is valid (and, on a worker
  // link, once the handler has verified): choose Worker or Voter. No worker
  // fields, and no old "कार्यकर्ता बनना है?" Yes/No — the type is picked here and
  // then the matching form opens (§1–§4).
  if (!regType) {
    return (
      <div className="min-h-screen bg-gray-50">
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

        <main className="max-w-xl mx-auto px-4 py-6 space-y-5">
          {/* Who is handling this session (worker link) stays visible here too. */}
          {session?.authenticated && session.handler && (
            <HandlerBadge handler={session.handler} onLogout={handlerLogout} t={t} />
          )}

          <div className="text-center pt-2">
            <h2 className="text-lg font-bold text-gray-900">{t.chooseTypeTitle}</h2>
            <p className="text-sm text-gray-500 mt-1">{t.chooseTypeSub}</p>
          </div>

          {/* Two large, stacked-on-mobile choices — simple and thumb-friendly. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button type="button" onClick={() => chooseType("worker")}
                    className="rounded-2xl border-2 border-gray-200 bg-white p-5 text-left hover:border-[#164FA3] hover:shadow-sm transition flex items-start gap-3">
              <span className="w-12 h-12 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: ACCENT }}>
                <UserPlus size={22} />
              </span>
              <span className="min-w-0">
                <span className="block text-base font-bold text-gray-900">{t.worker}</span>
                <span className="block text-[13px] text-gray-500 mt-0.5">{t.workerDesc}</span>
              </span>
            </button>
            <button type="button" onClick={() => chooseType("voter")}
                    className="rounded-2xl border-2 border-gray-200 bg-white p-5 text-left hover:border-[#164FA3] hover:shadow-sm transition flex items-start gap-3">
              <span className="w-12 h-12 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: ACCENT }}>
                <Vote size={22} />
              </span>
              <span className="min-w-0">
                <span className="block text-base font-bold text-gray-900">{t.voter}</span>
                <span className="block text-[13px] text-gray-500 mt-0.5">{t.voterDesc}</span>
              </span>
            </button>
          </div>

          <p className="text-center text-[11px] text-gray-400 pt-2">{t.footer}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Election details — the form's fixed header, set by the drive */}
      <header className="text-white" style={{ background: BRAND }}>
        <div className="max-w-xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <LeaderPhoto />
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-white/70">{t.org}</p>
                <h1 className="text-lg font-bold mt-0.5 truncate">{c.name || t.fallbackTitle}</h1>
              </div>
            </div>
            {/* The worker whose data is being collected — their Contacts photo in the
                header (§2). Shown only once a Contact is matched, and it is the worker,
                not the collector (§11). The language toggle stays alongside it. */}
            <div className="flex items-center gap-2 shrink-0">
              {personType === "worker" && workerPhoto ? <HeaderWorkerChip photo={workerPhoto.photo_url} name={workerPhoto.name || name} /> : null}
              {LangButton}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-5 space-y-4 pb-24">
        {/* Who is handling this session (the OTP-verified link owner) — clearly
            distinct from the worker being added (§7, §9). */}
        {session?.authenticated && session.handler && (
          <HandlerBadge handler={session.handler} onLogout={handlerLogout} t={t} />
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

          {/* The registration type was chosen on the first step (§1–§3). It is
              shown here as a compact, changeable summary — never the old
              "कार्यकर्ता बनना है?" Yes/No. "Change type" returns to that step. */}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-gray-800">
              {personType === "worker" ? <UserPlus size={16} style={{ color: ACCENT }} /> : <Vote size={16} style={{ color: ACCENT }} />}
              {personType === "worker" ? t.worker : t.voter}
            </span>
            <button type="button" onClick={backToSelection} className="text-[12px] font-semibold text-[#164FA3] underline">{t.changeType}</button>
          </div>

          {/* Worker identity — the matched Contact's photo alongside the worker's
              name, Worker/Contact ID and mobile (§1). Appears the moment the entered
              mobile matches a Contact that has a photo, so the worker's existing photo
              is prominent and never blank when one exists. */}
          {personType === "worker" && workerPhoto ? (
            <WorkerIdentityCard photo={workerPhoto.photo_url} name={workerPhoto.name || name}
              workerCode={workerPhoto.worker_code} contactId={workerPhoto.contact_id} mobile={mobile} t={t} />
          ) : null}

          <Field label={t.name} required>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePh} required />
          </Field>

          <Field label={t.mobile} required>
            <input className={inputCls} value={mobile} onChange={(e) => setMobile(e.target.value)}
                   inputMode="numeric" maxLength={15} placeholder={t.mobilePh} required />
          </Field>

          {/* Mobile verification, only when the drive asks for it. Rendered as
              part of the mobile question rather than as its own section: it is
              a property of that number, not another thing to fill in. */}
          {otpRequired ? (
            otpDone ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2.5">
                <span className="text-[13px] font-semibold text-green-800">{t.verified}</span>
                <button type="button" onClick={() => { setOtpStage("idle"); setOtpFor(""); setOtpCode(""); }}
                        className="text-[12px] font-semibold text-gray-500 underline">{t.changeNumber}</button>
              </div>
            ) : (
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 space-y-2">
                {otpStage === "sent" ? (
                  <>
                    {otpNote ? <p className="text-[12px] text-gray-600">{otpNote}</p> : null}
                    <div className="flex gap-2">
                      <input className={`${inputCls} flex-1`} value={otpCode}
                             onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                             inputMode="numeric" maxLength={8} placeholder={t.otpPh} aria-label={t.otpLabel} />
                      <button type="button" onClick={verifyCode} disabled={otpBusy || otpCode.length < 4}
                              className="h-12 px-5 rounded-xl text-white text-sm font-bold disabled:opacity-60"
                              style={{ background: ACCENT }}>
                        {otpBusy ? <Loader2 className="animate-spin" size={17} /> : t.verify}
                      </button>
                    </div>
                    <button type="button" onClick={sendCode} disabled={otpBusy}
                            className="text-[12px] font-semibold text-gray-600 underline disabled:opacity-60">
                      {t.resendOtp}
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={sendCode} disabled={otpBusy || !validMobile(mobile)}
                          className="h-11 w-full rounded-xl text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
                          style={{ background: ACCENT }}>
                    {otpBusy ? <Loader2 className="animate-spin" size={17} /> : null}{t.sendOtp}
                  </button>
                )}
              </div>
            )
          ) : null}

          <Field label={t.address}>
            <textarea className={`${inputCls} h-24 py-2.5 leading-relaxed`} value={address}
                      onChange={(e) => setAddress(e.target.value)} placeholder={t.addressPh} />
          </Field>

          {/* Constituency is chosen from the master list, never typed — free text
              would fill the reports with spelling variants of the same place. */}
          <Field label={t.constituency} required>
            <select className={inputCls} value={assemblyId} onChange={(e) => setAssemblyId(e.target.value)} required>
              <option value="">{t.selectConstituency}</option>
              {/* Assembly name follows the Preferred Language (§5): Hindi shows the
                  Hindi master name (name_hi), English the English name (name_en).
                  Only the DISPLAY changes — the submitted value (a.id) is identical
                  either way, so the stored Assembly is unchanged and validation stays
                  by id. Changing the language keeps the current selection (the option
                  values don't change), only the labels do. */}
              {(boot.constituencies || []).map((a) => (
                <option key={a.id} value={a.id}>{lang === "hi" ? (a.name_hi || a.name_en || a.name) : (a.name_en || a.name)}</option>
              ))}
            </select>
          </Field>

          {/* Block Name — worker-only, and a dropdown DEPENDENT on the selected
              Vidhan Sabha. It stays disabled until a constituency is chosen, then
              lists only that assembly's Blocks from the Political Location master.
              Empty mapping → a "No Blocks available" option. Hidden for a voter. */}
          {personType === "worker" && (
            <Field label={t.blockName} required>
              <select className={inputCls} value={blockId} onChange={(e) => setBlockId(e.target.value)}
                      disabled={!assemblyId || blocksLoading} required>
                <option value="">
                  {!assemblyId ? t.selectAssemblyFirst
                    : blocksLoading ? t.loadingBlocks
                    : blocks.length ? t.selectBlock
                    : t.noBlocks}
                </option>
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>{lang === "hi" ? (b.name_hi || b.name_en) : (b.name_en || b.name_hi)}</option>
                ))}
              </select>
              {blocksErr ? <p className="text-[12px] text-red-700 mt-1.5">{blocksErr}</p> : null}
            </Field>
          )}

          {/* Photo — Karykarta / Worker section ONLY. The Voter section has no photo
              field, upload button, camera button or capture option at all. Gating on
              personType (not just hiding buttons) also stops any cached/reused photo
              state from surfacing in the Voter flow. */}
          {personType === "worker" && (
          <div>
            <span className="block text-sm font-semibold text-gray-800 mb-2">{t.photo}</span>
            <div className="flex items-center gap-3">
              {/* Priority: a fresh manual capture/upload → the photo already stored
                  against this person's Contact (auto-filled, no re-upload) → the
                  empty placeholder. The Contact photo comes straight from the
                  Contacts store and falls back to the placeholder if its URL can't
                  load, so a broken/missing image never blocks the collector. */}
              {photoPreview ? (
                <img src={photoPreview} alt="" className="w-20 h-20 rounded-xl object-cover border border-gray-300 bg-white" />
              ) : workerPhoto?.photo_url ? (
                <ContactPhotoThumb src={workerPhoto.photo_url} />
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
                    {photoBusy ? t.uploading : ((photoPreview || workerPhoto?.photo_url) ? t.changePhoto : t.choosePhoto)}
                  </button>
                </div>
                {/* Tell the collector the photo was taken from Contacts (only when it
                    is the auto-filled one, not a manual upload) so they know it is
                    correct and needn't re-take it. */}
                {!photoPreview && workerPhoto?.photo_url ? (
                  <p className="text-[11px] font-semibold text-green-700">{t.photoFromContacts}</p>
                ) : (
                  <p className="text-[11px] text-gray-500">{t.photoHint}</p>
                )}
              </div>
              {/* Camera capture vs library choose — same handler, different source. */}
              <input ref={cameraInput} type="file" accept="image/*" capture="user" className="hidden" onChange={onPhoto} />
              <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPhoto} />
            </div>
            {photoErr ? <p className="text-[12px] text-red-700 mt-1.5">{photoErr}</p> : null}
          </div>
          )}

          {/* Karyakarta Rating (1–10) — worker branch only. Green scale, darker as
              the rating rises; the selected value is highlighted in its shade. */}
          {personType === "worker" && (
            <Field label={t.workerRating}>
              <RatingScale value={workerRating} onChange={setWorkerRating} />
              <p className="text-[11px] text-gray-500 mt-1.5">{t.workerRatingHint}</p>
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
            {now ? ` — ${now.toLocaleDateString("en-IN").replace(/\//g, "-")} ${now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}
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

// The worker/voter's Contacts photo in the form's photo slot. Same rounded frame as
// the manual preview, but it carries its own load-error guard: if the stored Contact
// URL is broken/unreachable it collapses to the empty placeholder (never a broken
// image), so the collector can still capture one. `src` re-arms the guard, so moving
// to the next person's photo starts clean.
function ContactPhotoThumb({ src }) {
  const [ok, setOk] = useState(true);
  useEffect(() => { setOk(true); }, [src]);
  if (src && ok) {
    return <img src={src} alt="" className="w-20 h-20 rounded-xl object-cover border border-gray-300 bg-white" onError={() => setOk(false)} />;
  }
  return (
    <div className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 bg-white flex items-center justify-center text-gray-400">
      <ImagePlus size={24} />
    </div>
  );
}

// A round profile avatar with an initials fallback (the app's existing placeholder
// style), used for the worker identity card. `photo` re-arms the load guard, so
// moving to the next person starts clean and a broken URL degrades to initials
// rather than a broken image.
function FormAvatar({ photo, name, className = "w-16 h-16", textCls = "text-xl" }) {
  const [ok, setOk] = useState(true);
  useEffect(() => { setOk(true); }, [photo]);
  if (photo && ok) {
    return <img src={photo} alt={name || ""} className={`${className} rounded-full object-cover border border-white shadow-sm shrink-0 bg-white`} onError={() => setOk(false)} />;
  }
  return (
    <span className={`${className} ${textCls} rounded-full bg-[#164FA3]/10 text-[#164FA3] flex items-center justify-center font-bold shrink-0`}>
      {String(name || "?").trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

// The selected worker's photo + name in the form's blue top bar (§2). It represents
// the WORKER whose data is being collected — never the signed-in collector, whose
// own identity stays in its own labelled badge (§11). Compact and truncating so it
// fits the header on a phone; its initials placeholder is tuned for the blue bar.
function HeaderWorkerChip({ photo, name }) {
  const [ok, setOk] = useState(true);
  useEffect(() => { setOk(true); }, [photo]);
  return (
    // On a phone the chip shows the photo alone: its name text used to eat ~42vw of
    // the header and squeezed the drive's title down to a couple of characters. The
    // worker's full name, ID and mobile are right below in the identity card, so
    // nothing is lost — the header keeps the photo (§2) and stays readable (§10).
    <span className="inline-flex items-center gap-2 max-w-[44vw] sm:max-w-[220px] rounded-full bg-white/15 py-1 pl-1 pr-1 sm:pr-2.5">
      {photo && ok ? (
        <img src={photo} alt={name || ""} className="w-8 h-8 rounded-full object-cover ring-1 ring-white/40 shrink-0" onError={() => setOk(false)} />
      ) : (
        <span className="w-8 h-8 rounded-full bg-white/25 text-white flex items-center justify-center text-xs font-bold shrink-0">
          {String(name || "?").trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
      <span className="hidden sm:inline text-sm font-semibold text-white truncate">{name}</span>
    </span>
  );
}

// The worker identity card shown at the top of the form once the entered mobile is
// matched to a Contact (§1): the SAME photo stored in Contacts, next to the worker's
// name, Worker/Contact ID and mobile. It only renders on a real photo match, so it
// is never a blank card, and it reads the number-tagged match so it can only ever
// describe the person currently in the form (§4, §8).
function WorkerIdentityCard({ photo, name, workerCode, contactId, mobile, t }) {
  const idLine = workerCode ? `${t.workerId}: ${workerCode}` : (contactId != null ? `${t.contactId}: ${contactId}` : "");
  const ten = String(mobile || "").replace(/\D/g, "").slice(-10);
  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-3 flex items-center gap-3">
      <FormAvatar photo={photo} name={name} />
      <div className="min-w-0">
        <p className="font-bold text-gray-900 truncate">{name || "—"}</p>
        {idLine ? <p className="text-xs text-gray-600 truncate">{idLine}</p> : null}
        {ten ? <p className="text-xs text-gray-600 truncate">{ten}</p> : null}
        {/* Only claim the photo came from Contacts when one actually did — a matched
            person whose Contact has no photo shows the initials placeholder instead
            (§9), and the collector can capture one. */}
        {photo ? <p className="text-[11px] font-semibold text-green-700 mt-0.5">{t.matchedFromContacts}</p> : null}
      </div>
    </div>
  );
}

function ListThumb({ src, name }) {
  const [ok, setOk] = useState(true);
  if (src && ok) return <img src={src} alt={name || ""} loading="lazy" className="w-11 h-11 rounded-full object-cover border border-gray-200 bg-white shrink-0" onError={() => setOk(false)} />;
  return <div className="w-11 h-11 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-[#164FA3] font-bold shrink-0">{String(name || "?").trim().charAt(0).toUpperCase() || "?"}</div>;
}

// The login gate for the COMMON registration link (/join). The karyakarta signs
// in with their Name (username) + generated password; the backend verifies it
// against reg_workers (bcrypt) and issues the session. No per-user URL, no OTP.
function RegLoginGate({ t, campaignName, toggleLang, onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Once the typed username identifies a real active worker, fetch their existing
  // photo — looked up server-side by that worker's registered MOBILE (§2/§3), never
  // by name. { name, photo_url } when identified (photo_url null → placeholder), or
  // null when the username is not recognized (then no photo is shown). Read-only.
  const [userPhoto, setUserPhoto] = useState(null);
  useEffect(() => {
    const u = username.trim();
    if (!u) { setUserPhoto(null); return; }
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/public/registration/join/user-photo?username=${encodeURIComponent(u)}`, { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (alive) setUserPhoto(d && d.name ? d : null);
      } catch { if (alive) setUserPhoto(null); }
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [username]);

  async function submit(e) {
    e?.preventDefault?.();
    setErr("");
    if (!username.trim() || !password) { setErr(t.errLoginFields); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/public/registration/join/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || t.errLogin); return; }
      onLoggedIn(d.handler || null);
    } catch { setErr(t.errLogin); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="text-white" style={{ background: BRAND }}>
        <div className="max-w-md mx-auto px-4 py-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <LeaderPhoto />
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-white/70">{t.org}</p>
              <h1 className="text-lg font-bold mt-0.5 truncate">{campaignName || t.fallbackTitle}</h1>
            </div>
          </div>
          <button type="button" onClick={toggleLang} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg bg-white/15 text-white hover:bg-white/25">
            <Languages size={14} />{t.switchTo}
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-6">
        <form onSubmit={submit} className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
          <div>
            <h2 className="text-base font-bold text-gray-900">{t.loginTitle}</h2>
            <p className="text-sm text-gray-500 mt-1">{t.loginHint}</p>
          </div>
          <label className="block">
            <span className="block text-sm font-semibold text-gray-800 mb-1.5">{t.usernameLabel}</span>
            <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t.usernamePh} autoComplete="username" autoCapitalize="words" />
          </label>
          {/* User's existing photo, shown above the password once the username
              identifies them (§2). Placeholder (initials) when no photo exists. */}
          {userPhoto && (
            <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
              <FormAvatar photo={userPhoto.photo_url} name={userPhoto.name} className="w-14 h-14" textCls="text-lg" />

              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{userPhoto.name}</p>
                <p className="text-xs text-gray-500 truncate">{campaignName || t.fallbackTitle}</p>
              </div>
            </div>
          )}
          <label className="block">
            <span className="block text-sm font-semibold text-gray-800 mb-1.5">{t.passwordLabel}</span>
            <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t.passwordPh} autoComplete="current-password" />
          </label>
          {err ? <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{err}</p> : null}
          <button type="submit" disabled={busy} className="w-full min-h-[52px] rounded-xl text-white text-base font-bold flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: BRAND }}>
            {busy ? <Loader2 className="animate-spin" size={20} /> : null} {busy ? t.signingIn : t.signIn}
          </button>
        </form>
        <p className="text-center text-[11px] text-gray-400 mt-4">{t.footer}</p>
      </main>
    </div>
  );
}

// The OTP gate shown before a WORKER link's form. Two steps: mobile → OTP. The
// mobile is the LINK OWNER's; the backend validates it against reg_workers and
// sends the OTP only to a registered handler (§2–§5).
const OTP_LEN = 6; // 2Factor AUTOGEN codes are 6 digits.

function RegOtpGate({ base, t, campaignName, toggleLang, onVerified }) {
  const [step, setStep] = useState("mobile"); // mobile | otp
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [masked, setMasked] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const post = (path, body) => fetch(`${base}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  // The code is sent and checked entirely server-side by 2Factor; this component
  // only collects it. Every message shown here comes from the backend, which is
  // what distinguishes "not the registered number" from "out of attempts" from
  // "provider down" without the client having to guess.
  async function requestOtp(e) {
    e?.preventDefault?.();
    setErr(""); setInfo("");
    const ten = mobile.replace(/\D/g, "").slice(-10);
    if (ten.length !== 10) { setErr(t.errMobile); return; }
    setBusy(true);
    try {
      const r = await post("request", { mobile: ten });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || t.errSave); return; }
      setMasked(d.phone || ""); setCooldown(30); setStep("otp");
    } catch { setErr(t.otpSendFailFb); }
    finally { setBusy(false); }
  }

  async function verifyOtp(e) {
    e?.preventDefault?.();
    setErr(""); setInfo("");
    if (!otp.trim()) { setErr(t.errOtp); return; }
    setBusy(true);
    try {
      const r = await post("verify", { mobile: mobile.replace(/\D/g, "").slice(-10), otp: otp.trim() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || t.errSave); return; }
      onVerified(d.handler || null);
    } catch { setErr(t.errSave); }
    finally { setBusy(false); }
  }

  async function resend() {
    if (cooldown > 0 || busy) return;
    setErr(""); setInfo(""); setBusy(true);
    try {
      const r = await post("resend", { mobile: mobile.replace(/\D/g, "").slice(-10) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.message || t.errSave); return; }
      setInfo(t.newOtpSent); setCooldown(30);
    } catch { setErr(t.otpSendFailFb); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="text-white" style={{ background: BRAND }}>
        <div className="max-w-md mx-auto px-4 py-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <LeaderPhoto />
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-white/70">{t.org}</p>
              <h1 className="text-lg font-bold mt-0.5 truncate">{campaignName || t.handlerTitle}</h1>
            </div>
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
        <p className="text-center text-[11px] text-gray-400 mt-4">{t.footer}</p>
      </main>
    </div>
  );
}
