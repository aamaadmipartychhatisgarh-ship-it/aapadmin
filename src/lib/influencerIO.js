import { query } from "@/lib/db";
import { resolveContactCardsBatch, resolveWorkersByPhones } from "@/lib/contactCard";
import { getInfluencerColumns, STATUSES, ECONOMIC_STATUSES } from "@/lib/influencerSchema";
import { norm, resolveLoc, ASSEMBLY_ALIASES } from "@/lib/workerImport";
import { INFLUENCER_IMPORT_FIELDS, mapInfluencerHeaders, influencerPhoneKey, validInfluencerPhone } from "@/lib/influencerColumns";

// Shared by the Influencer list (GET /api/influencers), its export and its bulk
// import, so all three apply the SAME filters, show the SAME Joined By and follow
// the SAME validation as the Add Influencer form.

export const INFLUENCER_SORTS = {
  newest: "created_at DESC",
  oldest: "created_at ASC",
  name_az: "name ASC",
  name_za: "name DESC",
  updated: "updated_at DESC",
};

// The list's search + filter WHERE (search / status / assembly / rating / next action).
export function influencerListWhere(searchParams) {
  const where = [];
  const params = [];
  const search = (searchParams.get("search") || "").trim();
  if (search) {
    where.push("(name LIKE ? OR phone LIKE ? OR assembly_name LIKE ? OR responsible_person LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  const status = (searchParams.get("status") || "").trim();
  if (status) { where.push("status = ?"); params.push(status); }
  const assemblyId = (searchParams.get("assembly_id") || "").trim();
  if (assemblyId) { where.push("assembly_id = ?"); params.push(assemblyId); }
  const rating = (searchParams.get("potential_rating") || "").trim();
  if (rating) { where.push("potential_rating = ?"); params.push(rating); }
  const nextAction = (searchParams.get("next_action") || "").trim();
  if (nextAction) { where.push("next_action = ?"); params.push(nextAction); }
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

// Resolve Joined By for a page of rows, in place (moved unchanged from the list
// route). Batched: contacts by id + phone, workers by phone — never per-row
// lookups. Precedence: the linked contact → else the phone-matched contact → else
// the phone-matched worker's position. Non-fatal on failure.
export async function enrichJoinedBy(rows) {
  const ten = (v) => { const d = String(v ?? "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : null; };
  const jbIds = [];
  const jbPhones = [];
  for (const r of rows) {
    if (r.joined_by_contact_id) jbIds.push(Number(r.joined_by_contact_id));
    const t = ten(r.joined_by_phone);
    if (t) jbPhones.push(t);
  }
  let byId = new Map();
  let byPhone = new Map();
  let workerByPhone = new Map();
  if (jbIds.length || jbPhones.length) {
    try {
      const res = await resolveContactCardsBatch({ ids: jbIds, phones10: jbPhones });
      byId = res.byId;
      byPhone = res.byPhone;
      workerByPhone = await resolveWorkersByPhones(jbPhones);
    } catch (e) {
      console.error("[influencer] batched Joined-By resolve failed:", e?.sqlMessage || e?.message || e);
    }
  }
  for (const r of rows) {
    const t = ten(r.joined_by_phone);
    let card = r.joined_by_contact_id ? byId.get(Number(r.joined_by_contact_id)) : null;
    if ((!card || !card.designation_name) && t) {
      const bp = byPhone.get(t);
      if (bp && (bp.designation_name || !card)) card = bp;
    }
    const worker = (!card || !card.designation_name) && t ? workerByPhone.get(t) : null;
    if (card) {
      r.joined_by_name = card.person_name || r.joined_by_name || null;
      r.joined_by_photo = card.photo_url || null;
      r.joined_by_mobile = card.phone_number || r.joined_by_phone || null;
      r.joined_by_designation = card.designation_name || (worker ? (String(worker.position || "").trim() || null) : null);
      r.joined_by_assembly = card.assembly_name || null;
    } else if (worker) {
      r.joined_by_name = worker.name || r.joined_by_name || null;
      r.joined_by_photo = worker.photo_url || null;
      r.joined_by_mobile = worker.mobile || r.joined_by_phone || null;
      r.joined_by_designation = String(worker.position || "").trim() || null;
    } else {
      r.joined_by_mobile = r.joined_by_phone || null;
      r.joined_by_designation = null;
    }
  }
  return rows;
}

export async function createdBySelect() {
  const cols = await getInfluencerColumns();
  return cols.has("created_by")
    ? "(SELECT username FROM users u WHERE u.id = influencers.created_by) AS created_by_name"
    : "NULL AS created_by_name";
}

// ---------------------------------------------------------------- EXPORT ---
// DATE columns arrive as strings; DATETIME as a Date → its local calendar day.
const d10 = (v) => {
  if (!v) return "";
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
};
export const INFLUENCER_EXPORT_COLUMNS = [
  ["Name", (r) => r.name], ["Phone", (r) => r.phone],
  ["Assembly", (r) => r.assembly_name], ["District", (r) => r.district_name],
  ["Lok Sabha", (r) => r.lok_sabha_name], ["Zone", (r) => r.zone_name], ["Address", (r) => r.address],
  ["Age", (r) => r.age], ["Caste", (r) => r.caste], ["Party", (r) => r.current_party],
  ["Years in Party", (r) => r.party_years], ["Political Position", (r) => r.political_position],
  ["Organisation Position", (r) => r.org_position], ["Associated Since", (r) => r.associated_since],
  ["Social Media", (r) => r.social_media], ["Team Size", (r) => r.team_size], ["Social Reach", (r) => r.social_reach],
  ["Economic Status", (r) => r.economic_status], ["Influencer Rating", (r) => r.influencer_rating],
  ["Status", (r) => r.status], ["Join Date", (r) => d10(r.join_date)], ["Cancelled Date", (r) => d10(r.cancelled_date)],
  ["Cancellation Remark", (r) => r.cancellation_remark],
  ["Joined By", (r) => r.joined_by_name], ["Joined By Phone", (r) => r.joined_by_mobile || r.joined_by_phone],
  ["Joined By Designation", (r) => r.joined_by_designation],
  ["Next Action", (r) => r.next_action], ["Follow-up Date", (r) => d10(r.follow_up_date)],
  ["Remark", (r) => r.remark], ["Added By", (r) => r.created_by_name], ["Added On", (r) => d10(r.created_at)],
];

// ---------------------------------------------------------------- IMPORT ---
const isBlank = (row) => !row || row.every((c) => String(c ?? "").trim() === "");

// Excel date cell (Date / serial) or text (YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY) → YYYY-MM-DD.
function toIsoDate(v) {
  if (v === null || v === undefined || String(v).trim() === "") return { ok: true, value: "" };
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear(), m = v.getMonth() + 1, d = v.getDate();
    return { ok: true, value: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  let y, mo, d;
  if (m) { [, y, mo, d] = m; } else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) { [, d, mo, y] = m; } else return { ok: false };
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) return { ok: false };
  return { ok: true, value: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

// Parse the sheet into candidate form payloads. Every non-blank data row lands in
// exactly one bucket: invalid (with reasons) | duplicate in file | candidate.
export async function parseInfluencerSheet(rows) {
  const idx = mapInfluencerHeaders(rows[0] || []);
  const missingCols = INFLUENCER_IMPORT_FIELDS.filter((f) => f.required && idx[f.key] === undefined).map((f) => f.label);
  if (missingCols.length) return { error: `Missing required column(s): ${missingCols.join(", ")}. Download the template for the expected headings.` };
  const assemblies = await query("SELECT id, name FROM locations WHERE type = 'assembly'");
  const asmByName = new Map(assemblies.map((a) => [norm(a.name), a.id]));
  const get = (row, k) => (idx[k] !== undefined ? row[idx[k]] : "");
  const str = (row, k) => { const v = get(row, k); return v instanceof Date ? v : String(v ?? "").trim(); };
  const candidates = [], rowErrors = [];
  const seen = new Map();
  let total = 0, invalid = 0, dupFile = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (isBlank(row)) continue;
    total++;
    const rowNum = i + 1;
    const name = str(row, "name");
    const phone = str(row, "phone");
    const reasons = [];
    if (!name) reasons.push("Name is required");
    if (!phone) reasons.push("Phone is required");
    else if (!validInfluencerPhone(phone)) reasons.push("Invalid phone number");
    const d = { name, phone };
    for (const f of INFLUENCER_IMPORT_FIELDS) {
      if (["name", "phone", "assembly", "status", "economic_status", "join_date", "cancelled_date"].includes(f.key)) continue;
      const v = str(row, f.key);
      if (v !== "") d[f.key] = v;
    }
    const asm = str(row, "assembly");
    if (asm) {
      const id = resolveLoc(norm(asm), asmByName, ASSEMBLY_ALIASES);
      if (id) d.assembly_id = id; else reasons.push(`Unknown assembly "${asm}"`);
    }
    const st = str(row, "status");
    if (st) {
      const hit = STATUSES.find((s) => s.toLowerCase() === st.toLowerCase());
      if (hit) d.status = hit; else reasons.push(`Invalid status "${st}" (use ${STATUSES.join(" / ")})`);
    }
    const eco = str(row, "economic_status");
    if (eco) {
      const hit = ECONOMIC_STATUSES.find((s) => s.toLowerCase() === eco.toLowerCase());
      if (hit) d.economic_status = hit; else reasons.push(`Invalid economic status "${eco}"`);
    }
    for (const k of ["join_date", "cancelled_date"]) {
      const r = toIsoDate(get(row, k));
      if (!r.ok) reasons.push(`Invalid ${k === "join_date" ? "join" : "cancelled"} date`); else if (r.value) d[k] = r.value;
    }
    if (reasons.length) {
      invalid++;
      rowErrors.push({ row: rowNum, name, mobile: String(phone || ""), severity: "error", reasons });
      continue;
    }
    const key = influencerPhoneKey(phone);
    if (seen.has(key)) {
      dupFile++;
      rowErrors.push({ row: rowNum, name, mobile: phone, severity: "duplicate", reasons: [`Duplicate of row ${seen.get(key)} in this file (same phone)`] });
      continue;
    }
    seen.set(key, rowNum);
    candidates.push({ row: rowNum, key, d });
  }
  return { total, invalid, dupFile, candidates, rowErrors };
}

// The normalized phones of every existing influencer (the duplicate check set).
export async function existingInfluencerPhoneKeys() {
  const rows = await query("SELECT phone FROM influencers WHERE phone IS NOT NULL AND phone <> ''");
  return new Set(rows.map((r) => influencerPhoneKey(r.phone)).filter(Boolean));
}
