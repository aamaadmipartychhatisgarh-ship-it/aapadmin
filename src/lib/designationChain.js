import { query } from "@/lib/db";
import { ensureContactDesignationsSchema } from "@/lib/contactDesignations";
import { ensureDesignationLevelColumn } from "@/lib/designationLevels";
import { logMasterDataChange } from "@/lib/audit";

// ADMINISTRATION DESIGNATION CHAIN — a TRUE parent-child appointment chain.
//
//   State → Lok Sabha → District → Assembly → Block
//
// For each of five roles (President, General Secretary, Vice President,
// Secretary, Joint Secretary) the holder at one organisational level is
// responsible for appointing the SAME role at the immediately lower level, and
// ONLY within the org unit that belongs to their own (a Lok Sabha President
// under Lok Sabha X can appoint District Presidents only for districts under X).
//
// This is stored, not just visual: every appointment records its immediate
// parent appointment AND its parent organisational unit, so the chain is a real
// parent-child structure in the database. It is master-driven — the roles come
// from the Designation Master, the org units from the Location Master — nothing
// per-record is hardcoded.
//
//   designation_appointments — one row per FILLED chain slot (chain × level ×
//     org unit), linking the appointed contact to its parent appointment + unit.
//   A slot with no row is VACANT. The structure (who may appoint whom) is derived
//   live from locations.parent_id, so a vacant parent never breaks the tree and
//   filling/vacating one level never deletes another.

export const CHAINS = [
  { key: "president", role: "President" },
  { key: "general_secretary", role: "General Secretary" },
  { key: "vice_president", role: "Vice President" },
  { key: "secretary", role: "Secretary" },
  { key: "joint_secretary", role: "Joint Secretary" },
];
const CHAIN_KEYS = new Set(CHAINS.map((c) => c.key));
export const roleOf = (chainKey) => CHAINS.find((c) => c.key === chainKey)?.role || null;

// The chain levels, top → bottom. (Zone is intentionally NOT part of this chain —
// the structural parent of a Lok Sabha in the chain is the single State node.)
export const CHAIN_LEVELS = ["state", "lok_sabha", "district", "assembly", "block"];
export const LEVEL_LABEL = { state: "State", lok_sabha: "Lok Sabha", district: "District", assembly: "Assembly", block: "Block" };
// The Location Master `type` for each level (block = ward). State has no location.
const LEVEL_TYPE = { lok_sabha: "lok_sabha", district: "district", assembly: "assembly", block: "ward" };
// The contact column that records a person's org unit at each level.
const CONTACT_LOC_COL = { lok_sabha: "lok_sabha_id", district: "district_id", assembly: "assembly_id", block: "ward_id" };

// A contact's EFFECTIVE org unit at a level. Lok Sabha is frequently not stored
// on the contact directly but derived up the district chain (district → its
// parent Lok Sabha), so mirror the existing vacancy logic and COALESCE it.
function effectiveUnitExpr(level) {
  if (level === "lok_sabha") {
    return "COALESCE(c.lok_sabha_id, (SELECT d.parent_id FROM locations d WHERE d.id = c.district_id))";
  }
  return `c.\`${CONTACT_LOC_COL[level]}\``;
}

export const levelIndex = (level) => CHAIN_LEVELS.indexOf(level);
export const parentLevelOf = (level) => { const i = levelIndex(level); return i > 0 ? CHAIN_LEVELS[i - 1] : null; };
export const childLevelOf = (level) => { const i = levelIndex(level); return i >= 0 && i < CHAIN_LEVELS.length - 1 ? CHAIN_LEVELS[i + 1] : null; };

// The canonical Designation-Master name for a role at a level, e.g. "District
// President". Matches the existing "<Level> <Role>" + level convention.
export function chainDesignationName(chainKey, level) {
  return `${LEVEL_LABEL[level]} ${roleOf(chainKey)}`;
}

let ensured = false;
const desigIdCache = new Map(); // `${chainKey}:${level}` → designation id

export async function ensureDesignationChainSchema() {
  if (ensured) return;
  try {
    await ensureDesignationLevelColumn(query);
    await ensureContactDesignationsSchema();
    await query(
      `CREATE TABLE IF NOT EXISTS designation_appointments (
         id INT AUTO_INCREMENT PRIMARY KEY,
         chain_key VARCHAR(40) NOT NULL,
         level VARCHAR(20) NOT NULL,
         location_id INT NULL,
         designation_id INT NULL,
         contact_id INT NOT NULL,
         parent_id INT NULL,
         parent_location_id INT NULL,
         appointed_by_user_id INT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         UNIQUE KEY uq_chain_slot (chain_key, level, location_id),
         KEY idx_parent (parent_id),
         KEY idx_chain (chain_key),
         KEY idx_contact (contact_id)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    // A UNIQUE that treats NULL location_id (State) as distinct per row would allow
    // duplicate State slots, so guard the State slot with an explicit sentinel:
    // store State's location_id as NULL but rely on app-level upsert-by-select.
    await ensureAllChainDesignations();
    ensured = true;
  } catch (e) {
    console.error("[chain] ensureDesignationChainSchema:", e?.message || e);
  }
}

// Ensure the Designation-Master row for every (role × level) exists and is mapped
// to the right level, REUSING any existing same-named row (so its id and any
// assignments are preserved — never a duplicate). Idempotent.
async function ensureAllChainDesignations() {
  const hasSortOrder = (await query("SHOW COLUMNS FROM designations LIKE 'sort_order'")).length > 0;
  const hasEnabled = (await query("SHOW COLUMNS FROM designations LIKE 'enabled'")).length > 0;
  for (let li = 0; li < CHAIN_LEVELS.length; li++) {
    const level = CHAIN_LEVELS[li];
    for (let ri = 0; ri < CHAINS.length; ri++) {
      const chainKey = CHAINS[ri].key;
      const name = chainDesignationName(chainKey, level);
      // eslint-disable-next-line no-await-in-loop
      const [existing] = await query("SELECT id, level FROM designations WHERE name = ? LIMIT 1", [name]);
      let id;
      if (existing) {
        id = existing.id;
        // Map an existing stray row (NULL/blank level) to its correct level; never
        // overwrite a level that is already set (e.g. the seeded State rows).
        if (!existing.level) {
          // eslint-disable-next-line no-await-in-loop
          await query("UPDATE designations SET level = ? WHERE id = ?", [level, id]);
        }
      } else {
        const cols = ["name", "level"];
        const vals = [name, level];
        if (hasSortOrder) { cols.push("sort_order"); vals.push(ri); }
        if (hasEnabled) { cols.push("enabled"); vals.push(1); }
        // eslint-disable-next-line no-await-in-loop
        const res = await query(
          `INSERT INTO designations (${cols.map((c) => `\`${c}\``).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
          vals
        );
        id = res.insertId;
      }
      desigIdCache.set(`${chainKey}:${level}`, id);
    }
  }
}

export async function chainDesignationId(chainKey, level) {
  await ensureDesignationChainSchema();
  return desigIdCache.get(`${chainKey}:${level}`) ?? null;
}

// --- location helpers -------------------------------------------------------

// The child org units of a (level, locationId) node, as chain slots, with their
// filled/vacant state and current holder. State → all Lok Sabhas; Lok Sabha →
// its districts; District → its assemblies; Assembly → its blocks (wards).
export async function listChildSlots(chainKey, level, locationId) {
  await ensureDesignationChainSchema();
  const childLevel = childLevelOf(level);
  if (!childLevel) return { childLevel: null, slots: [] };
  const childType = LEVEL_TYPE[childLevel];

  let units;
  if (level === "state") {
    // All Lok Sabha master rows, in the Lok Sabha Master sequence.
    units = await query(
      `SELECT id, name FROM locations WHERE type = ? ORDER BY (sort_order IS NULL), sort_order, name`,
      [childType]
    );
  } else {
    // Only the direct children of THIS org unit (parent_id) — this is what makes
    // the appointment scoped: a parent can only reach its own sub-units.
    units = await query(
      `SELECT id, name FROM locations WHERE type = ? AND parent_id = ? ORDER BY name`,
      [childType, locationId]
    );
  }
  if (!units.length) return { childLevel, slots: [] };

  const holders = await holdersFor(chainKey, childLevel, units.map((u) => u.id));
  const slots = units.map((u) => {
    const h = holders.get(u.id) || null;
    return {
      chain_key: chainKey,
      level: childLevel,
      location_id: u.id,
      location_name: u.name,
      filled: !!h,
      holder: h,
      has_children: childLevelOf(childLevel) != null,
    };
  });
  return { childLevel, slots };
}

// Current holders (contact) for a chain at a level, keyed by location_id.
async function holdersFor(chainKey, level, locationIds) {
  const map = new Map();
  if (!locationIds.length) return map;
  const ph = locationIds.map(() => "?").join(",");
  const rows = await query(
    `SELECT a.location_id, a.contact_id, a.parent_id, c.person_name, c.phone_number, c.photo_url
       FROM designation_appointments a
       JOIN contacts c ON c.id = a.contact_id
      WHERE a.chain_key = ? AND a.level = ? AND a.location_id IN (${ph})`,
    [chainKey, level, ...locationIds]
  );
  for (const r of rows) {
    map.set(r.location_id, {
      contact_id: r.contact_id, person_name: r.person_name,
      mobile: r.phone_number || null, photo_url: r.photo_url || null, parent_id: r.parent_id,
    });
  }
  return map;
}

// The single State-level node for a chain (its holder, if any).
export async function getStateNode(chainKey) {
  await ensureDesignationChainSchema();
  const [row] = await query(
    `SELECT a.contact_id, c.person_name, c.phone_number, c.photo_url
       FROM designation_appointments a
       JOIN contacts c ON c.id = a.contact_id
      WHERE a.chain_key = ? AND a.level = 'state' AND a.location_id IS NULL LIMIT 1`,
    [chainKey]
  );
  const holder = row
    ? { contact_id: row.contact_id, person_name: row.person_name, mobile: row.phone_number || null, photo_url: row.photo_url || null }
    : null;
  return { chain_key: chainKey, level: "state", location_id: null, location_name: "State", filled: !!holder, holder, has_children: true };
}

// Resolve a single slot's current holder (used to link a child to its parent).
async function getAppointment(chainKey, level, locationId) {
  const [row] = await query(
    `SELECT * FROM designation_appointments WHERE chain_key = ? AND level = ? AND ${locationId == null ? "location_id IS NULL" : "location_id = ?"} LIMIT 1`,
    locationId == null ? [chainKey, level] : [chainKey, level, locationId]
  );
  return row || null;
}

// The structural parent org unit of a (level, locationId): the immediate parent
// location, except a Lok Sabha's chain-parent is the State node (null unit).
async function parentUnitOf(level, locationId) {
  const parentLevel = parentLevelOf(level);
  if (!parentLevel) return null; // state has no parent
  if (parentLevel === "state") return { level: "state", location_id: null };
  const [row] = await query("SELECT parent_id FROM locations WHERE id = ? LIMIT 1", [locationId]);
  return { level: parentLevel, location_id: row?.parent_id ?? null };
}

// Eligible contacts to appoint into a slot: those whose org unit at this level
// matches the slot's unit (so by construction they belong to the correct parent).
// State is state-wide (any contact). Search filters name/phone.
export async function candidatesForSlot(chainKey, level, locationId, search = "", limit = 20) {
  await ensureDesignationChainSchema();
  const like = `%${String(search || "").trim()}%`;
  const useSearch = String(search || "").trim() !== "";
  if (level === "state") {
    const rows = await query(
      `SELECT id AS contact_id, person_name, phone_number, photo_url FROM contacts
        WHERE 1=1 ${useSearch ? "AND (person_name LIKE ? OR phone_number LIKE ?)" : ""}
        ORDER BY person_name LIMIT ${limit}`,
      useSearch ? [like, like] : []
    );
    return rows.map(shapeCandidate);
  }
  const rows = await query(
    `SELECT c.id AS contact_id, c.person_name, c.phone_number, c.photo_url FROM contacts c
      WHERE ${effectiveUnitExpr(level)} = ? ${useSearch ? "AND (c.person_name LIKE ? OR c.phone_number LIKE ?)" : ""}
      ORDER BY c.person_name LIMIT ${limit}`,
    useSearch ? [locationId, like, like] : [locationId]
  );
  return rows.map(shapeCandidate);
}
const shapeCandidate = (r) => ({ contact_id: r.contact_id, person_name: r.person_name, mobile: r.phone_number || null, photo_url: r.photo_url || null });

// --- appoint / vacate -------------------------------------------------------

// Appoint a person to a chain slot, storing the immediate parent appointment +
// parent org unit. Enforces scoping: the contact must belong to the slot's unit,
// and the slot's unit must belong to its structural parent. Non-destructive to
// other levels. Returns { ok } or { error } (a human message).
export async function appointChain(session, { chainKey, level, locationId, contactId }) {
  await ensureDesignationChainSchema();
  if (!CHAIN_KEYS.has(chainKey)) return { error: "Unknown designation chain." };
  if (!CHAIN_LEVELS.includes(level)) return { error: "Unknown level." };
  const cid = parseInt(contactId, 10);
  if (!Number.isInteger(cid) || cid <= 0) return { error: "Select a valid person." };

  let locId = level === "state" ? null : parseInt(locationId, 10);
  if (level !== "state") {
    if (!Number.isInteger(locId) || locId <= 0) return { error: "Select a valid organisational unit." };
    const [loc] = await query("SELECT id, name, type FROM locations WHERE id = ? LIMIT 1", [locId]);
    if (!loc || loc.type !== LEVEL_TYPE[level]) return { error: `Select a valid ${LEVEL_LABEL[level]}.` };
  }

  const [contact] = await query("SELECT id, person_name FROM contacts WHERE id = ? LIMIT 1", [cid]);
  if (!contact) return { error: "The selected person could not be found." };
  // The person must belong to this org unit — this is what prevents linking an
  // appointment to the WRONG parent organisational unit (§7). Uses the same
  // effective-unit derivation as the candidate list, so Lok Sabha resolves up the
  // district chain when it isn't stored on the contact directly.
  if (level !== "state") {
    const [belongs] = await query(
      `SELECT 1 AS ok FROM contacts c WHERE c.id = ? AND ${effectiveUnitExpr(level)} = ? LIMIT 1`,
      [cid, locId]
    );
    if (!belongs) {
      return { error: `That person does not belong to this ${LEVEL_LABEL[level]}. Choose a person from within it.` };
    }
  }

  const designationId = await chainDesignationId(chainKey, level);
  const parentUnit = await parentUnitOf(level, locId); // null for state
  let parentId = null;
  let parentLocationId = null;
  if (parentUnit) {
    parentLocationId = parentUnit.location_id; // structural parent unit (may be vacant)
    const parentAppt = await getAppointment(chainKey, parentUnit.level, parentUnit.location_id);
    parentId = parentAppt?.id ?? null; // appointment link (null when parent is vacant)
  }

  // Upsert the slot (one holder per chain × level × unit). Preserve the row id on
  // replace so children keep pointing at their parent slot.
  const existing = await getAppointment(chainKey, level, locId);
  let apptId;
  if (existing) {
    await query(
      `UPDATE designation_appointments SET contact_id = ?, designation_id = ?, parent_id = ?, parent_location_id = ?, appointed_by_user_id = ? WHERE id = ?`,
      [cid, designationId, parentId, parentLocationId, session?.user?.id ?? null, existing.id]
    );
    apptId = existing.id;
  } else {
    const res = await query(
      `INSERT INTO designation_appointments (chain_key, level, location_id, designation_id, contact_id, parent_id, parent_location_id, appointed_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [chainKey, level, locId, designationId, cid, parentId, parentLocationId, session?.user?.id ?? null]
    );
    apptId = res.insertId;
  }

  // The person genuinely HOLDS the designation in the shared assignment system,
  // so the vacancy/incomplete views reflect it too (additive — never removes any
  // other designation the person holds).
  if (designationId) {
    await query(`INSERT IGNORE INTO contact_designations (contact_id, designation_id) VALUES (?, ?)`, [cid, designationId]).catch(() => {});
  }

  // Filling this slot links any existing CHILD appointments that were waiting on
  // this org unit (their structural parent) but had no live parent appointment.
  const childLevel = childLevelOf(level);
  if (childLevel) {
    await query(
      `UPDATE designation_appointments SET parent_id = ?
        WHERE chain_key = ? AND level = ? AND parent_location_id ${locId == null ? "IS NULL" : "= ?"} AND (parent_id IS NULL OR parent_id <> ?)`,
      locId == null ? [apptId, chainKey, childLevel, apptId] : [apptId, chainKey, childLevel, locId, apptId]
    );
  }

  await logMasterDataChange(session, {
    master: "designation", action: existing ? "Updated" : "Created",
    recordId: apptId, recordName: `${chainDesignationName(chainKey, level)}${locId ? ` — appointment` : ""}`,
    after: { role: roleOf(chainKey), level, contact: contact.person_name, contact_id: cid, parent_location_id: parentLocationId },
  });
  return { ok: true, id: apptId };
}

// Vacate a chain slot (remove its holder). Existing lower-level appointments are
// PRESERVED — their appointment link to this (now-removed) parent is cleared, but
// their structural parent_location_id is kept, so the chain stays intact and they
// re-link automatically when the slot is filled again (§8).
export async function vacateChain(session, { chainKey, level, locationId }) {
  await ensureDesignationChainSchema();
  if (!CHAIN_KEYS.has(chainKey)) return { error: "Unknown designation chain." };
  if (!CHAIN_LEVELS.includes(level)) return { error: "Unknown level." };
  const locId = level === "state" ? null : parseInt(locationId, 10);
  const existing = await getAppointment(chainKey, level, locId);
  if (!existing) return { ok: true }; // already vacant

  await query(`DELETE FROM designation_appointments WHERE id = ?`, [existing.id]);
  // Keep children; just detach the (now gone) live parent link.
  await query(
    `UPDATE designation_appointments SET parent_id = NULL WHERE parent_id = ?`,
    [existing.id]
  );

  await logMasterDataChange(session, {
    master: "designation", action: "Deleted",
    recordId: existing.id, recordName: `${chainDesignationName(chainKey, level)} — appointment vacated`,
    before: { role: roleOf(chainKey), level, contact_id: existing.contact_id },
  });
  return { ok: true };
}

// Overall filled/vacant counts for a chain across every level (for the summary).
export async function chainSummary(chainKey) {
  await ensureDesignationChainSchema();
  const totals = {};
  // Total slots per level come from the masters; filled come from appointments.
  const filledRows = await query(
    `SELECT level, COUNT(*) AS n FROM designation_appointments WHERE chain_key = ? GROUP BY level`,
    [chainKey]
  );
  const filledByLevel = Object.fromEntries(filledRows.map((r) => [r.level, Number(r.n) || 0]));
  for (const level of CHAIN_LEVELS) {
    let total;
    if (level === "state") total = 1;
    else {
      const [{ n }] = await query("SELECT COUNT(*) AS n FROM locations WHERE type = ?", [LEVEL_TYPE[level]]);
      total = Number(n) || 0;
    }
    const filled = filledByLevel[level] || 0;
    totals[level] = { total, filled, vacant: Math.max(0, total - filled) };
  }
  return totals;
}
