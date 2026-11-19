import { query } from "@/lib/db";
import { buildVacancyTree } from "@/lib/vacancyTree";
import { normalizeIndianMobile } from "@/lib/phoneLinks";
import { fixedDesignationNames } from "@/lib/vacancyDesignationList";

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
//
// The message text is Hindi (fixed greeting + introduction); each post is "<Designation> – <unit>" with the Designation in ENGLISH, exactly
// as named in the Designation Master (by designation id) — never translated — and the unit name from the location master.

const LEVEL_ORDER = ["state", "lok_sabha", "district", "assembly", "block"];
const LEVEL_EN = { state: "State", lok_sabha: "Lok Sabha", district: "District", assembly: "Assembly", block: "Block" };
// A level already named in the designation (English or the Roman-Hindi forms used in the master).
const HAS_LEVEL = /\b(state|pradesh|lok ?sabha|loksabha|district|zila|jila|assembly|vidhan ?sabha|vidhansabha|vidhansbha|block|mandal|ward|booth)\b/i;
const DEVANAGARI = /[\u0900-\u097F]/;
// The same level words in Devanagari (\b does not apply to Devanagari, so a plain alternation).
const HAS_LEVEL_HI = /प्रदेश|लोकसभा|लोक सभा|जिला|ज़िला|विधानसभा|विधान सभा|ब्लॉक|मंडल|वार्ड|बूथ/;

// The designation exactly as it is named in the Designation Master (by its id) — the approved English name; never translated.
// The organisational level and the Wing are added in brackets ONLY when the master name does not already say them, e.g.
// "Coordinator (District)", "District Secretary (Mahila Wing)". A master name that is not in English is returned as recorded and
// reported (english: false) — it is never machine-translated.
export function englishDesignation(masterName, level, wing, mainWings = new Set()) {
  const name = String(masterName || "").trim();
  const extras = [];
  if (LEVEL_EN[level] && !HAS_LEVEL.test(name) && !HAS_LEVEL_HI.test(name)) extras.push(LEVEL_EN[level]);
  const w = String(wing || "").trim();
  if (w && !mainWings.has(w.toLowerCase())) {
    const base = w.replace(/\s*wing$/i, "").trim().toLowerCase();
    if (!name.toLowerCase().includes(base)) extras.push(/wing$/i.test(w) ? w : `${w} Wing`);
  }
  return { text: extras.length ? `${name} (${extras.join(", ")})` : name, english: !DEVANAGARI.test(name) };
}

// The approved message: this exact greeting and introduction, every assigned vacant post numbered 1..n (designation lines unchanged),
// then the closing request. No emoji.
export const MESSAGE_HEAD = "नमस्कार सर/मैडम,\n\nनिम्नलिखित पद वर्तमान में रिक्त हैं:";
export const MESSAGE_TAIL = "अतः अनुरोध है कि इन रिक्त पदों को जल्द से जल्द भरवाने की कृपा करें। कृपया इस कार्य को प्राथमिकता देते हुए आवश्यक कार्रवाई करने का कष्ट करें।";
export function consolidatedMessage(lines) {
  // Emoji never appear (a Designation / location name carrying one is cleaned too).
  const clean = (t) => String(t).replace(/\p{Extended_Pictographic}|\u{1F3FB}|\u{1F3FC}|\u{1F3FD}|\u{1F3FE}|\u{1F3FF}|\uFE0F/gu, "").replace(/\s+/g, " ").trim();
  return `${MESSAGE_HEAD}\n\n${lines.map((l, i) => `${i + 1}. ${clean(l)}`).join("\n")}\n\n${MESSAGE_TAIL}`;
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
  // Each designation's approved name, read from the Designation Master by id (the tree's own label as a fallback only).
  const ids = [...new Set(found.map(({ p }) => Number(p.designation_id)).filter((n) => Number.isInteger(n) && n > 0))];
  // Names as FIXED in the Designation Vacancies list (independent of later Master Data edits); master by id only as a fallback.
  const fixedNames = await fixedDesignationNames();
  const missingIds = ids.filter((i) => !fixedNames.has(i));
  const master = new Map([
    ...(missingIds.length ? (await query(`SELECT id, name FROM designations WHERE id IN (${missingIds.map(() => "?").join(",")})`, missingIds)).map((d) => [Number(d.id), d.name]) : []),
    ...[...fixedNames].filter(([i]) => ids.includes(i)),
  ]);
  const notEnglish = new Set();
  const lines = [];
  const used = new Set();
  const posts = found.map(({ p, parents }) => {
    const des = englishDesignation(master.get(Number(p.designation_id)) || p.designation_name, p.level, p.wing, mainWings);
    if (!des.english) notEnglish.add(des.text);
    const title = des.text;
    let line = p.level === "state" ? title : `${title} – ${p.location_name}`;
    // Two different posts that would read the same (equal unit names in different branches) get their parent unit.
    if (used.has(line)) {
      const up = [...parents].reverse().find((n) => n.level !== "state" && n.level !== p.level);
      if (up) line = `${line} (${LEVEL_EN[up.level] || ""} ${up.name})`.replace(/\(\s+/, "(");
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
    // Designations whose Designation Master name is not in English (shown as recorded, never machine-translated).
    names_not_english: [...notEnglish],
    message,
    mobile_valid: !!mobile,
    // International format (91 + 10 digits); the whole Hindi text, line breaks and emoji UTF-8 percent-encoded.
    wa_url: mobile && message ? `https://wa.me/91${mobile}?text=${encodeURIComponent(message)}` : null,
  };
}
