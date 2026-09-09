"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Languages, Loader2, ShieldAlert, UserPlus, Vote } from "lucide-react";

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
    constituency: "क्षेत्र", ward: "वार्ड", electionYear: "चुनाव वर्ष",
    assembly: "विधानसभा", lokSabha: "लोकसभा",
    savedTitle: "पंजीयन सफल!",
    savedBody: "अगला व्यक्ति जोड़ने के लिए नीचे फॉर्म भरें.",
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
    creditedTo: "यह पंजीयन दर्ज होगा:",
    myTotal: "आपके कुल पंजीयन", tallyVoters: "मतदाता", tallyWorkers: "नए कार्यकर्ता",
    autoTime: "पंजीयन दिनांक व समय स्वतः दर्ज होगा",
    submit: "सबमिट करें", saving: "सहेजा जा रहा है…",
    footer: "आम आदमी पार्टी छत्तीसगढ़",
    invalidTitle: "लिंक मान्य नहीं है",
    errName: "कृपया नाम भरें.",
    errMobile: "कृपया सही 10 अंकों का मोबाइल नंबर भरें.",
    errSave: "सहेजा नहीं जा सका. कृपया दोबारा प्रयास करें.",
    errLoad: "फॉर्म नहीं खुल सका. कृपया इंटरनेट जाँचें और दोबारा प्रयास करें.",
    switchTo: "English",
  },
  en: {
    org: "Aam Aadmi Party · Chhattisgarh",
    fallbackTitle: "Voter & Worker Registration",
    constituency: "Constituency", ward: "Ward", electionYear: "Election year",
    assembly: "Assembly", lokSabha: "Lok Sabha",
    savedTitle: "Registration saved!",
    savedBody: "Fill the form below to add the next person.",
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
    creditedTo: "This registration is credited to:",
    myTotal: "Your total registrations", tallyVoters: "voters", tallyWorkers: "new workers",
    autoTime: "Registration date & time are recorded automatically",
    submit: "Submit", saving: "Saving…",
    footer: "Aam Aadmi Party Chhattisgarh",
    invalidTitle: "This link is not valid",
    errName: "Please enter the name.",
    errMobile: "Enter a valid 10-digit mobile number.",
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
  const [boot, setBoot] = useState(null);      // { mode, campaign, worker, tally }
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
  const [ward, setWard] = useState("");
  const [areaBooth, setAreaBooth] = useState("");
  const honeypot = useRef(null);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [now, setNow] = useState(null);

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
      // A worker link carries that karyakarta's own ward/booth — a sensible
      // default for the people they register, still editable per person.
      setWard((v) => v || d.worker?.ward_number || d.campaign?.ward_number || "");
      setAreaBooth((v) => v || d.worker?.area_booth || "");
    } catch {
      setLoadErr(STRINGS.hi.errLoad);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function resetPerson() {
    setPersonType("voter"); setWantsWorker("yes"); setWorkerRole("");
    setName(""); setMobile(""); setAddress("");
    setAreaBooth(boot?.worker?.area_booth || "");
    setWard(boot?.worker?.ward_number || boot?.campaign?.ward_number || "");
  }


  async function submit(e) {
    e.preventDefault();
    setErr("");
    const validMobile = (v) => /^[6-9]\d{9}$/.test(String(v).replace(/\D/g, "").slice(-10));
    if (!name.trim()) { setErr(t.errName); return; }
    if (!validMobile(mobile)) { setErr(t.errMobile); return; }
    setSaving(true);
    try {
      // "Wants to become a worker" is only recorded as such when the person
      // actually confirms Yes; a No on that branch is an ordinary voter entry.
      const effectiveType = personType === "worker" && wantsWorker === "yes" ? "worker" : "voter";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_type: effectiveType,
          name: name.trim(),
          mobile: mobile.trim(),
          address: address.trim(),
          ward_number: ward.trim(),
          area_booth: areaBooth.trim(),
          worker_role: effectiveType === "worker" ? workerRole.trim() : "",
          website: honeypot.current?.value || "",
        }),
      });
      const d = await r.json().catch(() => ({}));
      // A server message (duplicate number, drive closed) is shown verbatim —
      // it carries detail the client cannot reconstruct, such as who already
      // registered that number.
      if (!r.ok) { setErr(d?.message || t.errSave); return; }
      setBoot((b) => (b ? { ...b, tally: d.tally || b.tally } : b));
      setDone(true);
      resetPerson();
      window.scrollTo({ top: 0, behavior: "smooth" });
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
  const w = boot.worker || null;
  const tally = boot.tally || null;
  const electionTypeLabel = c.election_type === "lok_sabha" ? t.lokSabha : t.assembly;

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
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            <div>
              <div className="text-white/60 text-[11px]">{t.constituency}</div>
              <div className="font-semibold">{c.constituency || "—"}</div>
              <div className="text-white/60 text-[11px]">{electionTypeLabel}</div>
            </div>
            <div>
              <div className="text-white/60 text-[11px]">{t.ward}</div>
              <div className="font-semibold">{c.ward_number || w?.ward_number || "—"}</div>
              <div className="text-white/60 text-[11px]">{t.electionYear} {c.election_year || "—"}</div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-5 space-y-4 pb-24">
        {done && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 flex items-start gap-3">
            <CheckCircle2 className="text-green-600 shrink-0 mt-0.5" size={22} />
            <div>
              <p className="font-semibold text-green-900 text-sm">{t.savedTitle}</p>
              <p className="text-[13px] text-green-800 mt-0.5">{t.savedBody}</p>
            </div>
          </div>
        )}

        {/* The person being registered comes FIRST — the very first question is
            what they are. Who gets the credit is asked at the end. */}
        <form onSubmit={submit} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-gray-900">{t.section1}</h2>

          {/* Honeypot — hidden from people, irresistible to bots. */}
          <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
                 className="absolute opacity-0 h-0 w-0 -z-10 pointer-events-none" />

          <div>
            <span className="block text-sm font-semibold text-gray-800 mb-2">{t.personType} <span className="text-red-600">*</span></span>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPersonType("voter")}
                      className={`h-14 rounded-xl border-2 text-sm font-semibold flex flex-col items-center justify-center gap-0.5 transition ${
                        personType === "voter" ? "text-white border-transparent" : "bg-white text-gray-700 border-gray-300"}`}
                      style={personType === "voter" ? { background: ACCENT } : undefined}>
                <Vote size={17} />{t.voter}
              </button>
              <button type="button" onClick={() => setPersonType("worker")}
                      className={`h-14 rounded-xl border-2 text-sm font-semibold flex flex-col items-center justify-center gap-0.5 transition ${
                        personType === "worker" ? "text-white border-transparent" : "bg-white text-gray-700 border-gray-300"}`}
                      style={personType === "worker" ? { background: ACCENT } : undefined}>
                <UserPlus size={17} />{t.wantsWorker}
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

          <div className="grid grid-cols-2 gap-3">
            <Field label={t.wardNo}>
              <input className={inputCls} value={ward} onChange={(e) => setWard(e.target.value)} placeholder={t.wardPh} />
            </Field>
            <Field label={t.areaBooth}>
              <input className={inputCls} value={areaBooth} onChange={(e) => setAreaBooth(e.target.value)} placeholder={t.areaPh} />
            </Field>
          </div>

          {/* Worker branch — only when the person chose "wants to be a worker" */}
          {personType === "worker" && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 space-y-3">
              <div>
                <span className="block text-sm font-semibold text-gray-800 mb-2">{t.interested}</span>
                <div className="flex gap-2">
                  {[["yes", t.yes], ["no", t.no]].map(([v, label]) => (
                    <button key={v} type="button" onClick={() => setWantsWorker(v)}
                            className={`h-11 px-5 rounded-xl border-2 text-sm font-semibold ${
                              wantsWorker === v ? "text-white border-transparent" : "bg-white text-gray-700 border-gray-300"}`}
                            style={wantsWorker === v ? { background: ACCENT } : undefined}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {wantsWorker === "yes" && (
                <Field label={t.workerRole}>
                  <input className={inputCls} value={workerRole} onChange={(e) => setWorkerRole(e.target.value)}
                         placeholder={t.workerRolePh} />
                </Field>
              )}
            </div>
          )}

          {/* Nobody types who is collecting — the link decides that. On a
              karyakarta's own generated link this is shown back to them as a
              statement of fact (and their running total); on the general link
              there is nothing to show at all. */}
          {w ? (
            <div className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2.5">
              <p className="text-[12px] text-gray-600">
                {t.creditedTo} <span className="font-semibold text-gray-900">{w.name}</span>
                {w.worker_code ? <span className="font-mono text-gray-400"> · {w.worker_code}</span> : null}
              </p>
              {tally?.total > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
                  <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-800 font-semibold">{t.myTotal}: {tally.total}</span>
                  <span className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-700">{t.tallyVoters} {tally.voters}</span>
                  <span className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-700">{t.tallyWorkers} {tally.new_workers}</span>
                </div>
              ) : null}
            </div>
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

        <p className="text-center text-[11px] text-gray-400 pb-4">{t.footer}</p>
      </main>
    </div>
  );
}
