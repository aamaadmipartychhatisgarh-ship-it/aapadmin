import { query } from "@/lib/db";
import { ensureContactDesignationsSchema } from "@/lib/contactDesignations";
import { ensureContactWingsSchema } from "@/lib/contactWings";
import { wingsMapFor } from "@/lib/designationWings";
import { listWings } from "@/lib/wingDesignations";
import { deriveRows, normalizeRows, sameRows } from "@/lib/designationRows";

const lc = (w) => String(w ?? "").trim().toLowerCase();

async function masterContext(designationIds) {
  const wingMaster = await listWings();
  const mainNames = wingMaster.filter((w) => Number(w.is_main) === 1).map((w) => w.name);
  const enabled = wingMaster.filter((w) => Number(w.is_main) !== 1 && (w.enabled == null || Number(w.enabled) === 1)).map((w) => w.name);
  let designations = [];
  if (designationIds.length) {
    const cols = new Set((await query("SHOW COLUMNS FROM designations")).map((r) => r.Field));
    designations = await query(
      `SELECT id, name, ${cols.has("wing") ? "wing" : "NULL AS wing"}${cols.has("enabled") ? ", enabled" : ", 1 AS enabled"} FROM designations WHERE id IN (${designationIds.map(() => "?").join(",")})`,
      designationIds
    );
  }
  const wmap = await wingsMapFor(designations);
  return { mainNames, enabled, designations, wmap };
}

// The contact's CURRENT combined rows (stored pairs + saved wings), derived exactly as the forms do.
export async function currentRowsFor(contactId) {
  await ensureContactDesignationsSchema(); await ensureContactWingsSchema();
  const pairs = await query("SELECT designation_id, wing FROM contact_designations WHERE contact_id = ? ORDER BY id", [contactId]);
  const wings = (await query("SELECT wing FROM contact_wings WHERE contact_id = ? ORDER BY id", [contactId])).map((r) => r.wing);
  const ids = pairs.map((p) => p.designation_id);
  const ctx = await masterContext(ids);
  const designationWings = Object.fromEntries(ids.map((id) => [id, ctx.wmap.get(id) || []]));
  return { rows: deriveRows({ pairs, wings, designationWings, mainNames: ctx.mainNames }), wings, mainNames: ctx.mainNames };
}

// Validate rows against Master Data. `existing` rows (already stored) are not re-validated, so a
// legacy combination is never rejected just because it is re-saved.
export async function validateRows(rows, existing = []) {
  const ids = rows.map((r) => r.designation_id).filter(Boolean);
  const ctx = await masterContext(ids);
  const known = new Map(ctx.designations.map((d) => [Number(d.id), d]));
  const wingByLc = new Map(ctx.enabled.map((w) => [lc(w), w]));
  const mainLc = new Set(ctx.mainNames.map(lc));
  const seenD = new Set(), seenW = new Set();
  const out = [];
  for (const r of rows) {
    const isExisting = existing.some((e) => e.designation_id === r.designation_id && lc(e.wing) === lc(r.wing));
    let wing = r.wing;
    if (wing && mainLc.has(lc(wing))) wing = "";
    if (wing && !isExisting) {
      const canon = wingByLc.get(lc(wing));
      if (!canon) return { error: `"${wing}" is not a Wing in Master Data.` };
      wing = canon;
    }
    if (r.designation_id) {
      const d = known.get(r.designation_id);
      if (!d) return { error: "That designation does not exist in Master Data." };
      if (seenD.has(r.designation_id)) return { error: `"${d.name}" is selected more than once. Each designation can be added once per contact.` };
      seenD.add(r.designation_id);
      if (!isExisting) {
        if (d.enabled != null && Number(d.enabled) === 0) return { error: `"${d.name}" is disabled in Master Data.` };
        const dw = (ctx.wmap.get(r.designation_id) || []).filter(Boolean);
        const dwNonMain = dw.filter((w) => !mainLc.has(lc(w)));
        if (wing && !dw.some((w) => lc(w) === lc(wing))) return { error: `"${d.name}" does not belong to the ${wing}.` };
        if (!wing && dwNonMain.length && dwNonMain.length === dw.length) return { error: `"${d.name}" belongs to ${dwNonMain.join(", ")}; choose that Wing for it.` };
      }
    } else {
      if (!wing) continue;
      if (seenW.has(lc(wing))) return { error: `The ${wing} is selected more than once.` };
    }
    if (wing) seenW.add(lc(wing));
    out.push({ designation_id: r.designation_id, wing });
  }
  return { rows: out, mainNames: ctx.mainNames };
}

// Turn data.designation_rows into the fields the routes already understand
// (designation_ids / wings). contactId omitted = a new contact (everything validated).
// Returns { error } | { none: true } (not sent / nothing to change) | { rows, conflict? }.
export async function prepareDesignationRows(data, { contactId = null, canClear = true } = {}) {
  if (!data || !("designation_rows" in data)) return { none: true };
  const sent = normalizeRows(data.designation_rows);
  const strip = () => { delete data.designation_rows; delete data.designation_rows_prev; delete data.designation_ids; delete data.designation_ids_prev; delete data.designation_id; delete data.wings; };
  if (!contactId) {
    const v = await validateRows(sent);
    if (v.error) return { error: v.error };
    delete data.designation_rows; delete data.designation_rows_prev;
    data.designation_ids = v.rows.filter((r) => r.designation_id).map((r) => r.designation_id);
    data.wings = [...new Set(v.rows.map((r) => r.wing).filter(Boolean))];
    return { rows: v.rows };
  }
  const cur = await currentRowsFor(contactId);
  if ("designation_rows_prev" in data) {
    const prev = normalizeRows(data.designation_rows_prev);
    if (sameRows(sent, prev)) { strip(); return { none: true }; }              // not edited: stale copy
    if (!sameRows(prev, cur.rows)) { strip(); return { none: true, conflict: true }; } // changed meanwhile
  } else if (sameRows(sent, cur.rows)) { strip(); return { none: true }; }
  if (!sent.length && !canClear) { strip(); return { none: true }; }
  const v = await validateRows(sent, cur.rows);
  if (v.error) return { error: v.error };
  const mainKept = cur.wings.filter((w) => v.mainNames.some((m) => lc(m) === lc(w)));
  data.designation_ids = v.rows.filter((r) => r.designation_id).map((r) => r.designation_id);
  data.designation_ids_prev = cur.rows.filter((r) => r.designation_id).map((r) => r.designation_id);
  data.wings = [...new Set([...v.rows.map((r) => r.wing).filter(Boolean), ...mainKept])];
  delete data.designation_rows; delete data.designation_rows_prev; delete data.designation_id;
  return { rows: v.rows };
}

// After the designation set has been synced: record which Wing each designation is paired with.
export async function applyRowWings(contactId, rows) {
  if (!rows) return;
  for (const r of rows) {
    if (!r.designation_id) continue;
    // eslint-disable-next-line no-await-in-loop
    await query("UPDATE contact_designations SET wing = ? WHERE contact_id = ? AND designation_id = ?", [r.wing || null, contactId, r.designation_id]);
  }
}
