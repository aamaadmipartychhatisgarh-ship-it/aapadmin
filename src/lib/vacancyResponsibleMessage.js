import { query } from "@/lib/db";
import { buildVacancyTree } from "@/lib/vacancyTree";
import { normalizeIndianMobile } from "@/lib/phoneLinks";

// ONE consolidated Hindi WhatsApp message per RESPONSIBLE PERSON on Designation Vacancies (Tree Map).
//
// Which posts: every post that is VACANT right now AND whose "Assigned By" (the vacancy-responsibility rule,
// lib/vacancyResponsibility → vacancyDashboard.responsible_slots → vacancyTree.assigned_by) lists THIS person by their
// Contact id. It is computed from the very tree the page shows — rebuilt live on every request over ALL Wings and every
// level, within the signed-in user's own territory scope — so:
//   • a post filled since the last click is gone (it is no longer vacant);
//   • a new vacancy, or one whose responsible role this person now holds, appears;
//   • a post whose responsibility moved to someone else (they now hold the responsible role) leaves this person's list;
//   • each post appears once (the tree's own post key: level × unit × designation × Wing).
// Nothing is matched by name, nothing is cached, nothing is written or sent: the result is a wa.me link with the message
// pre-filled for the user to review, edit and send in WhatsApp.

const LEVEL_ORDER = ["state", "lok_sabha", "district", "assembly", "block"];
const LEVEL_HI = { state: "प्रदेश", lok_sabha: "लोकसभा", district: "जिला", assembly: "विधानसभा", block: "ब्लॉक" };

// Level words a designation name may already carry (removed — the post's ACTUAL level from the master is used instead).
const LEVEL_WORDS = /\b(state|pradesh|lok ?sabha|loksabha|district|zila|jila|assembly|vidhan ?sabha|vidhansabha|vidhansbha|block)\b/gi;

// English / Roman-Hindi designation words → Hindi, longest phrase first. Unknown words are kept as recorded.
const PHRASES = [
  ["general secretary organisation", "महासचिव (संगठन)"], ["general secretary organization", "महासचिव (संगठन)"],
  ["general secretary media", "महासचिव (मीडिया)"],
  ["karyakari adhyaksh", "कार्यकारी अध्यक्ष"], ["working president", "कार्यकारी अध्यक्ष"],
  ["vice president", "उपाध्यक्ष"], ["upadhyaksha", "उपाध्यक्ष"], ["upadhyaksh", "उपाध्यक्ष"], ["upadyaksh", "उपाध्यक्ष"],
  ["general secretary", "महासचिव"], ["joint secretary", "संयुक्त सचिव"], ["office secretary", "कार्यालय सचिव"],
  ["organisation secretary", "संगठन सचिव"], ["organization secretary", "संगठन सचिव"],
  ["sanghathan mantri", "संगठन मंत्री"], ["sangathan mantri", "संगठन मंत्री"], ["sanghatan mantri", "संगठन मंत्री"],
  ["seh prabhari", "सह प्रभारी"], ["sah prabhari", "सह प्रभारी"], ["co prabhari", "सह प्रभारी"],
  ["media prabhari", "मीडिया प्रभारी"], ["media incharge", "मीडिया प्रभारी"], ["media in charge", "मीडिया प्रभारी"],
  ["social media", "सोशल मीडिया"], ["chief spokesperson", "मुख्य प्रवक्ता"], ["spokesperson", "प्रवक्ता"],
  ["vice treasurer", "उप कोषाध्यक्ष"], ["treasurer", "कोषाध्यक्ष"], ["booth worker", "बूथ कार्यकर्ता"],
  ["adhyaksha", "अध्यक्ष"], ["adhyaksh", "अध्यक्ष"], ["president", "अध्यक्ष"],
  ["secretary", "सचिव"], ["prabhari", "प्रभारी"], ["incharge", "प्रभारी"], ["in charge", "प्रभारी"],
  ["coordinator", "समन्वयक"], ["member", "सदस्य"], ["observer", "पर्यवेक्षक"], ["convenor", "संयोजक"], ["convener", "संयोजक"],
  ["organisation", "संगठन"], ["organization", "संगठन"], ["media", "मीडिया"], ["mantri", "मंत्री"], ["worker", "कार्यकर्ता"],
];
const WING_HI = {
  "sc wing": "एससी विंग", "st wing": "एसटी विंग", "youth wing": "युवा विंग", "mahila wing": "महिला विंग", "rti wing": "आरटीआई विंग",
  "legal wing": "विधि विंग", "transport wing": "ट्रांसपोर्ट विंग", "rwa wing": "आरडब्ल्यूए विंग", "obc wing": "ओबीसी विंग",
  "social media wing": "सोशल मीडिया विंग", "ex-employee wing": "पूर्व कर्मचारी विंग", "asap wing": "ASAP विंग",
  "minority wing": "अल्पसंख्यक विंग", "labour wing": "श्रमिक विंग", "trade wing": "व्यापार विंग", "kisan wing": "किसान विंग",
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "District President" (level district) → "जिला अध्यक्ष"; "State General Secretary" (state) → "प्रदेश महासचिव";
// "Mahila Wing President" → "जिला अध्यक्ष (महिला विंग)". A name already in Devanagari is kept, with the level added if absent.
export function hindiDesignation(name, level, wing, mainWings = new Set()) {
  const raw = String(name || "").trim();
  const levelHi = LEVEL_HI[level] || "";
  const wingKey = String(wing || "").trim().toLowerCase();
  const wingHi = wingKey && !mainWings.has(wingKey) ? (WING_HI[wingKey] || String(wing).trim()) : "";
  let role;
  if (/[ऀ-ॿ]/.test(raw)) {
    role = raw;
    if (levelHi && !raw.includes(levelHi) && !/प्रदेश|लोकसभा|लोक सभा|जिला|ज़िला|विधानसभा|विधान सभा|ब्लॉक/.test(raw)) role = `${levelHi} ${role}`;
    return wingHi && !role.includes(wingHi.replace(/ विंग$/, "")) ? `${role} (${wingHi})` : role;
  }
  let rest = raw.toLowerCase().replace(/[\/,()]+/g, " ");
  // The Wing is said once, in brackets — removed from the role words if the name repeats it.
  if (wingKey) rest = rest.replace(new RegExp(`\\b${esc(wingKey)}\\b`, "g"), " ").replace(new RegExp(`\\b${esc(wingKey.replace(/\s*wing$/, ""))}\\b`, "g"), " ");
  rest = rest.replace(LEVEL_WORDS, " ").replace(/[-–]+/g, " ").replace(/\s+/g, " ").trim();
  let out = ` ${rest} `;
  for (const [en, hi] of PHRASES) out = out.replace(new RegExp(`(?<=\\s)${esc(en)}(?=\\s)`, "g"), hi);
  out = out.replace(/\s+/g, " ").trim();
  // Unknown words keep their recorded spelling (capitalised as in the master).
  if (/[a-z]/.test(out)) {
    const words = raw.split(/\s+/);
    out = out.split(" ").map((w) => (/[a-z]/.test(w) ? (words.find((x) => x.toLowerCase() === w) || w) : w)).join(" ");
  }
  role = [levelHi, out].filter(Boolean).join(" ");
  return wingHi ? `${role} (${wingHi})` : role;
}

export const MESSAGE_HEAD = "नमस्कार सर 🙏🏻\nनिम्नलिखित पद वर्तमान में रिक्त हैं:";
export const MESSAGE_TAIL = "अतः अनुरोध है कि इन रिक्त पदों को जल्द से जल्द भरवाने की कृपा करें। कृपया इस कार्य को प्राथमिकता देते हुए आवश्यक कार्रवाई करने का कष्ट करें।";
export function consolidatedMessage(lines) {
  return `${MESSAGE_HEAD}\n\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n\n${MESSAGE_TAIL}`;
}

// The live vacant posts this person (contact id) is responsible for + the pre-filled WhatsApp link.
export async function buildResponsibleMessage(session, contactId) {
  const [person] = await query("SELECT id, person_name, phone_number FROM contacts WHERE id = ? LIMIT 1", [contactId]);
  if (!person) return { error: "Responsible person not found.", status: 404 };

  const { tree } = await buildVacancyTree(session, { wing: "" });   // ALL Wings, every level, the user's own scope
  const mainWings = new Set((await query("SELECT name FROM wings WHERE is_main = 1").catch(() => [])).map((w) => String(w.name).trim().toLowerCase()));

  // Walk the tree in its own order (location master order, Designation order within a unit).
  const found = [];
  const seen = new Set();
  let order = 0;
  const walk = (node, parents) => {
    for (const p of node.posts || []) {
      order += 1;
      if (p.status !== "vacant" || !p.assigned_by) continue;
      const mine = (p.assigned_by.slots || []).some((sl) => (sl.people || []).some((h) => Number(h.contact_id) === Number(contactId)));
      if (!mine || seen.has(p.key)) continue;           // only this person's posts; each post once
      seen.add(p.key);
      found.push({ p, order, parents });
    }
    for (const c of node.children || []) walk(c, [...parents, node]);
  };
  walk(tree, []);

  // Top level first (State → Lok Sabha → District → Assembly → Block), then the tree order.
  found.sort((a, b) => (LEVEL_ORDER.indexOf(a.p.level) - LEVEL_ORDER.indexOf(b.p.level)) || (a.order - b.order));
  const lines = [];
  const used = new Set();
  const posts = found.map(({ p, parents }) => {
    const title = hindiDesignation(p.designation_name, p.level, p.wing, mainWings);
    let line = p.level === "state" ? title : `${title} – ${p.location_name}`;
    // Two different posts that would read the same (equal unit names in different branches) get their parent unit.
    if (used.has(line)) {
      const up = [...parents].reverse().find((n) => n.level !== "state" && n.level !== p.level);
      if (up) line = `${line} (${LEVEL_HI[up.level] || ""} ${up.name})`.replace(/\(\s+/, "(");
    }
    used.add(line);
    lines.push(line);
    return {
      key: p.key, designation_id: p.designation_id, designation_name: p.designation_name, wing: p.wing || null,
      level: p.level, level_label: p.level_label, location_id: p.location_id, location_name: p.location_name, line,
    };
  });

  const mobile = normalizeIndianMobile(person.phone_number);
  const message = posts.length ? consolidatedMessage(lines) : null;
  return {
    contact_id: person.id,
    name: person.person_name,
    count: posts.length,
    posts,
    message,
    mobile_valid: !!mobile,
    // International format (91 + 10 digits); the whole Hindi text, line breaks and emoji UTF-8 percent-encoded.
    wa_url: mobile && message ? `https://wa.me/91${mobile}?text=${encodeURIComponent(message)}` : null,
  };
}
