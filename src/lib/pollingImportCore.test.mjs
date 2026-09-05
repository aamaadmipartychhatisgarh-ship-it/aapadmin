import test from "node:test";
import assert from "node:assert/strict";
import { classifyPollingRows } from "./pollingImportCore.js";

// Master Data fixture: two plain assemblies, one whose master name is the
// canonical form of a known alias (Raipur City North ← "Raipur North"), and a
// name that repeats across two districts (ambiguous without a District column).
const MASTER = [
  { assembly_id: 1, name: "Kondagaon", district: "Kondagaon" },
  { assembly_id: 2, name: "Raipur City North", district: "Raipur" },
  { assembly_id: 3, name: "Bindrawagarh", district: "Gariaband" },
  { assembly_id: 10, name: "Bhanupratappur", district: "Kanker North" },
  { assembly_id: 11, name: "Bhanupratappur", district: "Kanker South" },
];
// Assembly 2 already has polling data → importing it counts as an UPDATE.
const HAS_POLLING = [2];

const HEADER = ["Assembly", "District", "Total Voters", "Male Voters", "Female Voters", "Total Booths"];
const run = (dataRows, master = MASTER, has = HAS_POLLING) =>
  classifyPollingRows([HEADER, ...dataRows], { masterRows: master, hasPollingIds: has });

test("matched assembly with valid figures → a new valid row", () => {
  const r = run([["Kondagaon", "Kondagaon", 245000, 126000, 119000, 312]]);
  assert.equal(r.validRows.length, 1);
  assert.equal(r.validRows[0].assembly_id, 1);
  assert.equal(r.validRows[0].isUpdate, false);
  assert.deepEqual(
    [r.validRows[0].total_voters, r.validRows[0].male_voters, r.validRows[0].female_voters, r.validRows[0].total_booths],
    [245000, 126000, 119000, 312]
  );
  assert.equal(r.summary.to_add, 1);
  assert.equal(r.summary.to_update, 0);
  assert.equal(r.summary.invalid, 0);
});

test("assembly that already has polling data is classified as an UPDATE, not a new add", () => {
  const r = run([["Raipur City North", "Raipur", 300000, 155000, 145000, 400]]);
  assert.equal(r.validRows.length, 1);
  assert.equal(r.validRows[0].isUpdate, true);
  assert.equal(r.summary.to_update, 1);
  assert.equal(r.summary.to_add, 0);
});

test("assembly not in Master Data → unmatched + invalid, never a valid row (master is never extended)", () => {
  const r = run([["Nonexistent Vidhan Sabha", "", 100, 50, 50, 10]]);
  assert.equal(r.validRows.length, 0);
  assert.deepEqual(r.unmatchedAssemblies, ["Nonexistent Vidhan Sabha"]);
  assert.equal(r.summary.invalid, 1);
  assert.match(r.rowErrors[0].reasons.join(" "), /not found in Master Data/i);
});

test("non-numeric / negative figures are rejected with per-field reasons", () => {
  const r = run([["Kondagaon", "Kondagaon", "abc", -5, 100, 10]]);
  assert.equal(r.validRows.length, 0);
  assert.equal(r.summary.invalid, 1);
  const reasons = r.rowErrors[0].reasons.join(" | ");
  assert.match(reasons, /Total Voters must be a whole number/);
  assert.match(reasons, /Male Voters must be a whole number/);
});

test("Male + Female cannot exceed Total Voters", () => {
  const r = run([["Kondagaon", "Kondagaon", 100, 60, 60, 10]]);
  assert.equal(r.validRows.length, 0);
  assert.match(r.rowErrors[0].reasons.join(" "), /cannot exceed Total Voters/);
});

test("within-file duplicate assembly: first kept, later ones flagged as duplicate and skipped", () => {
  const r = run([
    ["Kondagaon", "Kondagaon", 245000, 126000, 119000, 312],
    ["Kondagaon", "Kondagaon", 999999, 500000, 499999, 999],
  ]);
  assert.equal(r.validRows.length, 1);
  assert.equal(r.validRows[0].total_voters, 245000); // the FIRST occurrence wins
  assert.equal(r.summary.duplicates_in_file, 1);
  const dup = r.rowErrors.find((e) => e.severity === "duplicate");
  assert.ok(dup);
  assert.match(dup.reasons.join(" "), /Duplicate of row 2/);
});

test("ambiguous assembly name (same name in two districts) is rejected without a District column", () => {
  const r = run([["Bhanupratappur", "", 100, 50, 50, 10]]);
  assert.equal(r.validRows.length, 0);
  assert.match(r.rowErrors[0].reasons.join(" "), /more than one district/i);
});

test("ambiguous assembly name resolves when the District column disambiguates", () => {
  const r = run([["Bhanupratappur", "Kanker South", 100, 50, 50, 10]]);
  assert.equal(r.validRows.length, 1);
  assert.equal(r.validRows[0].assembly_id, 11);
});

test("assembly spelling alias maps to the canonical master name (Raipur North → Raipur City North)", () => {
  const r = run([["Raipur North", "", 300000, 155000, 145000, 400]]);
  assert.equal(r.validRows.length, 1);
  assert.equal(r.validRows[0].assembly_id, 2);
});

test("blank figures store as null (unknown), not 0; thousands separators are tolerated", () => {
  const r = run([["Kondagaon", "Kondagaon", "2,45,000", "", "", ""]]);
  assert.equal(r.validRows.length, 1);
  assert.equal(r.validRows[0].total_voters, 245000);
  assert.equal(r.validRows[0].male_voters, null);
  assert.equal(r.validRows[0].female_voters, null);
  assert.equal(r.validRows[0].total_booths, null);
});

test("a row missing the Assembly value is an error, not a silent skip", () => {
  const r = run([["", "Kondagaon", 100, 50, 50, 10]]);
  assert.equal(r.validRows.length, 0);
  assert.equal(r.summary.invalid, 1);
  assert.match(r.rowErrors[0].reasons.join(" "), /Assembly is required/);
});

test("fully blank rows (trailing spreadsheet empties) are skipped, not counted", () => {
  const r = run([
    ["Kondagaon", "Kondagaon", 245000, 126000, 119000, 312],
    ["", "", "", "", "", ""],
    ["   ", "", "", "", "", ""],
  ]);
  assert.equal(r.validRows.length, 1);
  assert.equal(r.summary.total_rows, 1); // blanks not in total
  assert.equal(r.summary.invalid, 0);
});

test("header aliases are recognized (VIDHANSABHA / VOTERS / BOOTHS, any case & spacing)", () => {
  const altHeader = ["VIDHANSABHA", "JILA", "Total  Voters ", "Male", "Female", "Booths"];
  const r = classifyPollingRows(
    [altHeader, ["Kondagaon", "Kondagaon", 245000, 126000, 119000, 312]],
    { masterRows: MASTER, hasPollingIds: HAS_POLLING }
  );
  assert.equal(r.validRows.length, 1);
  assert.equal(r.validRows[0].total_voters, 245000);
});

test("a sheet with no ASSEMBLY column is rejected outright", () => {
  const r = classifyPollingRows([["District", "Total Voters"], ["Kondagaon", 100]], { masterRows: MASTER });
  assert.ok(r.error);
  assert.match(r.error, /ASSEMBLY column/i);
});

test("a sheet with only a header (no data rows) is rejected", () => {
  const r = classifyPollingRows([HEADER], { masterRows: MASTER });
  assert.ok(r.error);
});
