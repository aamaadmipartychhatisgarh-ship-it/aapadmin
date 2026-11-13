import { query } from "@/lib/db";
import { contactPhotoMap } from "@/lib/contactPhotos";
import { buildVacancyDataset } from "@/lib/vacancyDashboard";
import { normalizeIndianMobile } from "@/lib/phoneLinks";
import { TOTAL_LEVELS, levelConfig } from "@/lib/designationApprovals";

// DESIGNATION VACANCIES — TREE MAP.
//
// The tree is a VIEW over the same live dataset the Designation Vacancies list uses (lib/vacancyDashboard):
// every post is one (level x organisational unit x designation) with its holders, computed from the contacts'
// own designation assignments (contact_designations) and the Designation Master (designations.level, order,
// Wings) — so the list and the tree can never disagree, and the caller's territory scope is already applied.
//
// Hierarchy: State -> Lok Sabha -> District -> Assembly (Vidhan Sabha) [-> any further level the dataset
// carries], following the location master's parent chain (locations.parent_id, resolved by ancestryOf). A post
// hangs under the node of ITS level and unit; a unit's parent is the nearest ancestor unit of a higher level that
// the location chain actually records (so a unit with a broken chain is not dropped - it attaches higher up).
//
// Proposed person for a VACANT post: an in-progress Designation Approval request (designation_assignments with
// status 'pending' or 'returned') for that same designation at that same unit — the existing workflow that
// records who has been put forward for a post. Nobody else is ever shown as the proposed person.

// Ancestry field of each level (on a dataset row) and its Hindi name for the WhatsApp message.
const LEVEL_FIELD = { lok_sabha: "lok_sabha", district: "district", assembly: "assembly", block: "block" };
const LEVEL_HI = { state: "प्रदेश", lok_sabha: "लोकसभा", district: "ज़िला", assembly: "विधानसभा", block: "ब्लॉक" };
// Which designation_assignments location column identifies the unit of a post at each level (State = any).
const PROPOSAL_COL = { lok_sabha: "lok_sabha_id", district: "district_id", assembly: "assembly_id", block: "block_id" };
const MAX_TREE_POSTS = 60000;

async function tableExists(name) {
  const r = await query("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1", [name]);
  return r.length > 0;
}
async function columnExists(table, col) {
  const r = await query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1", [table, col]);
  return r.length > 0;
}

// The pre-filled Hindi WhatsApp message to a proposed person.
export function proposalMessage({ name, designation, level, location }) {
  const where = level === "state" ? "प्रदेश स्तर" : `${LEVEL_HI[level] || ""} ${location || ""}`.trim();
  return `नमस्ते ${name} जी,\nआपको ${where} के "${designation}" पद के लिए प्रस्तावित किया गया है। कृपया इस संबंध में अपनी सहमति एवं उपलब्धता की पुष्टि करें।\nधन्यवाद।`;
}

// wa.me link (WhatsApp app on phones, WhatsApp Web on desktop) — or null when the number is not a valid
// Indian mobile, so no broken link is ever produced.
export function whatsappLink(mobile, text) {
  const m = normalizeIndianMobile(mobile);
  return m ? `https://wa.me/91${m}?text=${encodeURIComponent(text)}` : null;
}

// In-progress approval requests for the given designations, bucketed by "designationId" (state) or
// "designationId:level:unitId". Returns an empty map when the approval workflow has never been set up.
async function loadProposals(designationIds) {
  const byKey = new Map();
  const ids = [...new Set(designationIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length || !(await tableExists("designation_assignments"))) return byKey;
  const hasBlock = await columnExists("designation_assignments", "block_id");
  const rows = await query(
    `SELECT a.id, a.member_id, a.designation_id, a.status, a.current_level,
            a.lok_sabha_id, a.district_id, a.assembly_id, ${hasBlock ? "a.block_id" : "NULL AS block_id"},
            COALESCE(NULLIF(TRIM(c.person_name), ''), a.member_name) AS name,
            COALESCE(NULLIF(TRIM(c.phone_number), ''), a.member_phone) AS phone,
            COALESCE(NULLIF(TRIM(c.photo_url), ''), NULLIF(TRIM(a.member_photo_url), '')) AS photo_url
       FROM designation_assignments a
       LEFT JOIN contacts c ON c.id = a.member_id
      WHERE a.status IN ('pending', 'returned') AND a.designation_id IN (${ids.map(() => "?").join(",")})
      ORDER BY a.created_at, a.id`,
    ids
  );
  for (const r of rows) {
    const p = {
      assignment_id: r.id, contact_id: r.member_id || null, name: String(r.name || "").trim(), phone: r.phone || null, photo_url: r.photo_url || null,
      status: r.status, stage: r.current_level, stage_total: TOTAL_LEVELS,
      stage_label: r.status === "returned" ? "Returned for correction" : `Approval stage ${r.current_level}/${TOTAL_LEVELS}${levelConfig(r.current_level) ? ` · ${levelConfig(r.current_level).label}` : ""}`,
      loc: { lok_sabha: r.lok_sabha_id, district: r.district_id, assembly: r.assembly_id, block: r.block_id },
    };
    if (!p.name) continue;
    const k = String(r.designation_id);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  }
  return byKey;
}

function proposalsForPost(byDesignation, post) {
  const list = byDesignation.get(String(post.designation_id)) || [];
  const col = PROPOSAL_COL[post.level];
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (post.level !== "state" && (!col || Number(p.loc[post.level]) !== Number(post.location_id))) continue;
    // One entry per person (a contact id, else the name + mobile snapshot).
    const key = p.contact_id ? `c${p.contact_id}` : `n${p.name.toLowerCase()}|${normalizeIndianMobile(p.phone) || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const message = proposalMessage({ name: p.name, designation: post.designation_name, level: post.level, location: post.location_name });
    const wa = whatsappLink(p.phone, message);
    out.push({
      assignment_id: p.assignment_id, contact_id: p.contact_id, name: p.name, photo_url: p.photo_url,
      stage_label: p.stage_label, whatsapp_url: wa, mobile_valid: !!wa,
    });
  }
  return out;
}

// "District President" + "District Prabhari" -> "District President / Prabhari" (shared leading words said once).
export function shortRoles(labels) {
  const ls = [...new Set((labels || []).map((l) => String(l || "").trim()).filter(Boolean))];
  if (ls.length <= 1) return ls[0] || "";
  const words = ls.map((l) => l.split(/\s+/));
  let k = 0;
  while (words.every((w) => w.length > k + 1 && w[k].toLowerCase() === words[0][k].toLowerCase())) k++;
  return [ls[0], ...words.slice(1).map((w) => w.slice(k).join(" "))].join(" / ");
}

function assignedBy(slots, designationName) {
  // A post is never shown as assigned by itself (e.g. the State Prabhari post under the State Prabhari rule).
  const self = String(designationName || "").trim().toLowerCase();
  const ss = (slots || []).filter((x) => x && x.label && String(x.label).trim().toLowerCase() !== self);
  if (!ss.length) return null;
  const people = [];
  const seen = new Set();
  for (const x of ss) for (const p of x.people || []) {
    const k = p.contact_id || p.name;
    if (seen.has(k)) continue;
    seen.add(k);
    people.push({ name: p.name, role: p.designation || x.label });
  }
  // One line per responsible role (rule order), each with the person(s) who hold it IN THIS post's area — matched
  // by the rule's contact ids, with their current photo — or none when nobody holds it there.
  const slotsOut = ss.map((x) => ({
    label: x.label,
    area: x.area || null,
    people: (x.people || []).map((p) => ({ contact_id: p.contact_id || null, name: p.name, photo_url: p.photo_url || null })),
  }));
  return { label: shortRoles(ss.map((x) => x.label)), areas: [...new Set(ss.map((x) => x.area).filter(Boolean))], people, slots: slotsOut };
}

export async function buildVacancyTree(session, { wing } = {}) {
  const data = await buildVacancyDataset(session, { wing, status: "combined", maxRows: MAX_TREE_POSTS });
  const levels = (data.filters?.levels || []).map((l) => l.key);
  const levelLabel = Object.fromEntries((data.filters?.levels || []).map((l) => [l.key, l.label]));
  const posts = data.vacancies || [];

  // Child order: the location master's order (Lok Sabha by its sequence, the rest by name) as served for the filters.
  const orderOf = new Map();
  const TYPE_KEY = { lok_sabha: "lok_sabha", district: "district", assembly: "assembly", block: "block" };
  for (const [lvl, key] of Object.entries(TYPE_KEY)) (data.filters?.locations?.[key] || []).forEach((l, i) => orderOf.set(`${lvl}:${l.id}`, i));

  const photo = await contactPhotoMap(posts.flatMap((p) => (p.holders || []).map((h) => Number(h.contact_id))));
  const proposals = await loadProposals(posts.filter((p) => p.status !== "filled").map((p) => Number(p.designation_id)));

  const nodes = new Map();
  const root = { id: "state", level: "state", level_label: levelLabel.state || "State", location_id: 0, name: "State Level", posts: [], children: [], parent: null };
  nodes.set(root.id, root);
  const nodeFor = (level, id, name, parent) => {
    const key = `${level}:${id}`;
    let n = nodes.get(key);
    if (!n) {
      n = { id: key, level, level_label: levelLabel[level] || level, location_id: id, name: name || `#${id}`, posts: [], children: [], parent: parent.id };
      nodes.set(key, n);
      parent.children.push(n);
    }
    return n;
  };
  // The node of a post: walk its ancestry from the top level down to its own level.
  const placeOf = (r) => {
    if (r.level === "state") return root;
    let cur = root;
    const upto = levels.indexOf(r.level);
    for (let i = 1; i <= upto; i++) {
      const lvl = levels[i];
      const f = LEVEL_FIELD[lvl];
      const id = lvl === r.level ? r.location_id : (f ? r[`${f}_id`] : null);
      const name = lvl === r.level ? r.location_name : (f ? r[`${f}_name`] : null);
      if (id == null) continue;           // missing link in the location chain: attach to the nearest recorded ancestor
      cur = nodeFor(lvl, id, name, cur);
    }
    return cur;
  };

  const seenPost = new Set();
  for (const r of posts) {
    const key = `${r.level}:${r.location_id}:${r.designation_id}:${r.designation_wing || ""}`;
    if (seenPost.has(key)) continue;    // one card per post, never twice
    seenPost.add(key);
    const node = placeOf(r);
    const filled = r.status === "filled";
    const holders = [];
    const seenH = new Set();
    for (const h of r.holders || []) {
      const id = Number(h.contact_id);
      if (seenH.has(id)) continue;
      seenH.add(id);
      holders.push({ contact_id: id, name: h.name, photo_url: photo.get(id) || null });
    }
    node.posts.push({
      key,
      designation_id: r.designation_id,
      designation_name: r.designation_name,
      wing: r.designation_wing || null,
      level: r.level,
      level_label: r.level_label,
      location_id: r.location_id,
      location_name: r.level === "state" ? "State" : r.location_name,
      status: filled ? "filled" : "vacant",
      needs_review: r.status === "review",
      review_people: (r.review_people || []).map((p) => p.person_name || p.name).filter(Boolean),
      holders: filled ? holders : [],
      proposed: filled ? [] : proposalsForPost(proposals, { ...r, location_name: r.level === "state" ? "State" : r.location_name }),
      // Who is responsible for filling this vacant post (the existing vacancy-responsibility rule) — shown as
      // "Assigned By: District President / Prabhari", with the people who currently hold those roles.
      assigned_by: filled ? null : assignedBy(r.responsible_slots, r.designation_name),
    });
  }

  // Counts: own posts + every descendant's, each post counted exactly once (it lives on one node only).
  const finish = (n) => {
    n.children.sort((a, b) => ((orderOf.get(a.id) ?? 1e9) - (orderOf.get(b.id) ?? 1e9)) || String(a.name).localeCompare(String(b.name)));
    let total = n.posts.length;
    let filled = n.posts.filter((p) => p.status === "filled").length;
    for (const c of n.children) { finish(c); total += c.counts.total; filled += c.counts.filled; }
    n.counts = { total, filled, vacant: total - filled, own_total: n.posts.length, own_vacant: n.posts.filter((p) => p.status === "vacant").length };
    delete n.parent;
  };
  finish(root);

  return {
    tree: root,
    levels: (data.filters?.levels || []),
    wings: data.filters?.wings || [],
    applied: data.applied,
    capped: !!data.capped,
    counts: root.counts,
  };
}
