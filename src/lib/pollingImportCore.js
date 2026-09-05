import { norm, ASSEMBLY_ALIASES, DISTRICT_ALIASES } from "./cgGeoAliases.js";

// PURE parse + validate core for the Polling Station Master (Voter Master) bulk
// importer — no DB, no framework imports (only the pure alias tables via a
// RELATIVE path), so it is exercised directly by `node --test`. The DB reads
// live in src/lib/pollingImport.js, which calls classifyPollingRows() below with
// the master data it fetched. Preview (dry-run) and commit both go through this
// one function, so the counts shown in the preview are EXACTLY what gets written.
//
// The Polling Station Master stores ONE aggregate row per master Assembly
// (la_polling_data, UNIQUE assembly_id): total_voters / male_voters /
// female_voters / total_booths. District / Lok Sabha / Zone are DERIVED from the
// Master Data location tree and are NEVER imported. Master Data is the single
// source of truth: an assembly not already in master is reported unmatched and
// skipped — never created. Matching is by assembly NAME (+ CG spelling aliases),
// disambiguated by District when a name repeats across districts, resolved to
// la_assemblies.id (the primary relationship every polling query uses).

// Header aliases — matched case-insensitively, whitespace-collapsed, trailing
// punctuation dropped (so "Total Voters." / "TOTAL  VOTERS" both match).
const COLUMN_MAP = {
  assembly: ["assembly", "assembly constituency", "assembly name", "vidhansabha", "vidhan sabha", "constituency", "ac", "ac name"],
  district: ["district", "jila", "zila"],
  total_voters: ["total voters", "voters", "total_voters", "total voter", "electors", "total electors"],
  male_voters: ["male voters", "male", "male_voters", "male voter", "male electors"],
  female_voters: ["female voters", "female", "female_voters", "female voter", "female electors"],
  total_booths: ["total booths", "booths", "total_booths", "booth", "booth count", "no of booths", "number of booths"],
};

// The exact header row written into the downloadable sample template, in order.
export const TEMPLATE_HEADERS = ["Assembly", "District", "Total Voters", "Male Voters", "Female Voters", "Total Booths"];

function buildHeaderIndex(headerRow) {
  const idx = {};
  (headerRow || []).forEach((h, i) => {
    const key = String(h || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.:]+$/, "");
    if (!key) return;
    for (const [field, names] of Object.entries(COLUMN_MAP)) {
      if (idx[field] === undefined && names.includes(key)) idx[field] = i;
    }
  });
  return idx;
}

// Validate one polling count: blank → null; otherwise a whole number ≥ 0.
// Returns { value } on success or { error } with a human message (no throw, so
// every bad field on a row is collected into one error report). Tolerates the
// thousands separators a spreadsheet may carry ("1,23,456" / "12 345").
function parseCount(raw, label) {
  const s = String(raw ?? "").trim();
  if (s === "") return { value: null };
  const cleaned = s.replace(/[,\s]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return { error: `${label} must be a whole number (0 or more)` };
  }
  return { value: n };
}

// rows            AOA from the sheet (row 0 = header).
// masterRows      [{ assembly_id, name, district }] — every assembly in Master Data.
// hasPollingIds   iterable of assembly_ids that already have a polling row (→ update).
export function classifyPollingRows(rows, { masterRows = [], hasPollingIds = [] } = {}) {
  if (!Array.isArray(rows) || rows.length < 2) {
    return { error: "Sheet has no data rows." };
  }
  const headerIdx = buildHeaderIndex(rows[0]);
  if (headerIdx.assembly === undefined) {
    return { error: "Could not find an ASSEMBLY column in the sheet. Use the sample template." };
  }

  // name → [ {assembly_id, district} ] (a list, so a name shared across districts
  // is detected as ambiguous rather than silently mis-mapped).
  const byName = new Map();
  for (const m of masterRows) {
    const k = norm(m.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push({ assembly_id: m.assembly_id, district: m.district });
  }
  const hasPolling = new Set([...hasPollingIds].map((x) => Number(x)));

  const resolveAssembly = (name, district) => {
    const k = norm(name);
    let list = byName.get(k);
    if (!list) {
      const aliased = ASSEMBLY_ALIASES[k];
      if (aliased) list = byName.get(norm(aliased));
    }
    if (!list || list.length === 0) return { status: "unmatched" };
    if (list.length === 1) return { status: "ok", match: list[0] };
    // Ambiguous name — disambiguate by district (with district aliases too).
    const dk = norm(district);
    if (dk) {
      const dAliased = DISTRICT_ALIASES[dk];
      const hit = list.find((m) => norm(m.district) === dk || (dAliased && norm(m.district) === norm(dAliased)));
      if (hit) return { status: "ok", match: hit };
    }
    return { status: "ambiguous", districts: list.map((m) => m.district).filter(Boolean) };
  };

  const validRows = [];
  const rowErrors = [];
  const unmatched = new Set();
  const seenAssemblyIds = new Map(); // assembly_id → first file row that used it
  let newCount = 0, updateCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i] || [];
    const cell = (field) => (headerIdx[field] === undefined ? "" : raw[headerIdx[field]]);
    const assemblyName = String(cell("assembly") ?? "").trim();
    const districtName = String(cell("district") ?? "").trim();
    // Skip a fully blank row (trailing empties are common in spreadsheets).
    const allBlank = ["assembly", "district", "total_voters", "male_voters", "female_voters", "total_booths"]
      .every((f) => String(cell(f) ?? "").trim() === "");
    if (allBlank) continue;

    const rowNo = i + 1; // 1-based, header is row 1 — matches what the user sees.
    const reasons = [];

    if (!assemblyName) {
      rowErrors.push({ row: rowNo, assembly: "", reasons: ["Assembly is required"], severity: "error" });
      continue;
    }

    const tv = parseCount(cell("total_voters"), "Total Voters");
    const mv = parseCount(cell("male_voters"), "Male Voters");
    const fv = parseCount(cell("female_voters"), "Female Voters");
    const tb = parseCount(cell("total_booths"), "Total Booths");
    for (const r of [tv, mv, fv, tb]) if (r.error) reasons.push(r.error);

    // Male + Female cannot exceed Total Voters (same rule as the single editor),
    // only checked when the values needed for the comparison are present.
    if (!tv.error && !mv.error && !fv.error) {
      const mf = (mv.value || 0) + (fv.value || 0);
      if (tv.value != null && (mv.value != null || fv.value != null) && mf > tv.value) {
        reasons.push("Male + Female voters cannot exceed Total Voters");
      }
    }

    const res = resolveAssembly(assemblyName, districtName);
    if (res.status === "unmatched") {
      unmatched.add(assemblyName);
      reasons.push("Assembly not found in Master Data");
    } else if (res.status === "ambiguous") {
      reasons.push(`Assembly name exists in more than one district (${res.districts.join(", ")}) — add a District column to disambiguate`);
    }

    if (reasons.length) {
      rowErrors.push({ row: rowNo, assembly: assemblyName, reasons, severity: "error" });
      continue;
    }

    const assemblyId = res.match.assembly_id;
    // Within-file duplicate: the same assembly listed twice — keep the FIRST,
    // flag the rest (ambiguous which figures should win).
    if (seenAssemblyIds.has(assemblyId)) {
      rowErrors.push({
        row: rowNo, assembly: assemblyName, severity: "duplicate",
        reasons: [`Duplicate of row ${seenAssemblyIds.get(assemblyId)} (same assembly) — skipped`],
      });
      continue;
    }
    seenAssemblyIds.set(assemblyId, rowNo);

    const isUpdate = hasPolling.has(Number(assemblyId));
    if (isUpdate) updateCount++; else newCount++;
    validRows.push({
      assembly_id: assemblyId,
      assembly_name: res.match.district ? `${assemblyName} (${res.match.district})` : assemblyName,
      total_voters: tv.value,
      male_voters: mv.value,
      female_voters: fv.value,
      total_booths: tb.value,
      isUpdate,
    });
  }

  const withinFileDuplicates = rowErrors.filter((e) => e.severity === "duplicate").length;
  const invalid = rowErrors.filter((e) => e.severity === "error").length;

  return {
    validRows,
    rowErrors,
    unmatchedAssemblies: [...unmatched],
    summary: {
      total_rows: validRows.length + rowErrors.length,
      to_add: newCount,
      to_update: updateCount,
      duplicates_in_file: withinFileDuplicates,
      invalid,
    },
  };
}
