import { query } from "@/lib/db";
import { buildVacancyDataset } from "@/lib/vacancyDashboard";
import { normalizeIndianMobile } from "@/lib/phoneLinks";

// Hindi (Roman script) WhatsApp reminder for ONE responsible person about the vacant posts they must fill in ONE
// Lok Sabha (or at State level). Built from the same live vacancy dataset the page shows — so it covers only the
// vacancies the signed-in user may see — using the existing Assigned By relationship: a post is included only
// when it is VACANT and this person (by contact id) is one of its resolved responsible people. Every Wing is
// included (the person is responsible for them whatever Wing the page is filtered to). Nothing is recorded or
// sent: the result is a wa.me click-to-chat link with the message pre-filled for the user to review and send.

const STATE_KEY = "state";

// "A", "A aur B", "A, B aur C".
function hindiList(items) {
  if (items.length <= 1) return items[0] || "";
  return `${items.slice(0, -1).join(", ")} aur ${items[items.length - 1]}`;
}

// "Raipur" -> "Raipur Lok Sabha"; a master name that already says Lok Sabha is kept as it is.
function lokSabhaTitle(name) {
  const n = String(name || "").trim();
  return /lok\s*sabha|loksabha|लोकसभा|लोक सभा/i.test(n) ? n : `${n} Lok Sabha`;
}

export function hindiReminderMessage(areaTitle, posts) {
  return `${areaTitle} mein ${hindiList(posts)} ki posts abhi khaali padi hain. Aapko in posts ko jald se jald bharna hai. Kripya is kaarya ko priority par poora karein.`;
}

// lokSabhaId: a Lok Sabha location id, or "state" for State-level posts.
export async function buildHindiReminder(session, contactId, lokSabhaId) {
  const isState = String(lokSabhaId) === STATE_KEY;
  const lsId = isState ? null : parseInt(lokSabhaId, 10);
  if (!isState && !(Number.isInteger(lsId) && lsId > 0)) return { error: "A valid Lok Sabha is required.", status: 400 };

  const [person] = await query("SELECT id, person_name, phone_number FROM contacts WHERE id = ? LIMIT 1", [contactId]);
  if (!person) return { error: "Responsible person not found.", status: 404 };

  // All Wings, vacant posts of this responsible person (the dataset's own responsible filter), in Designation order.
  const data = await buildVacancyDataset(session, { wing: "", status: "vacant", responsibleId: contactId, maxRows: 60000 });
  const mine = (data.vacancies || []).filter((r) => r.status === "vacant"
    && (r.responsibles || []).some((rp) => Number(rp.contact_id) === Number(contactId))
    && (isState ? (r.level === "state" || r.lok_sabha_id == null) : Number(r.lok_sabha_id) === lsId));
  if (!mine.length) return { error: "No vacant posts are pending with this person in this Lok Sabha.", status: 404 };

  // One entry per post; a post below the Lok Sabha level names its unit so equal designations stay distinct.
  const seen = new Set();
  const posts = [];
  for (const r of mine) {
    const label = r.level === "state" || r.level === "lok_sabha" ? r.designation_name : `${r.designation_name} (${r.location_name})`;
    if (seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    posts.push(label);
  }
  const areaTitle = isState ? "Pradesh" : lokSabhaTitle(mine.find((r) => r.lok_sabha_name)?.lok_sabha_name || "");
  const message = hindiReminderMessage(areaTitle, posts);
  // The responsible person's registered mobile (their contact record), as resolved for the vacancy.
  const mobile = normalizeIndianMobile(person.phone_number);
  return {
    contact_id: person.id,
    name: person.person_name,
    lok_sabha_name: isState ? null : areaTitle,
    posts,
    message,
    mobile_valid: !!mobile,
    wa_url: mobile ? `https://wa.me/91${mobile}?text=${encodeURIComponent(message)}` : null,
  };
}
