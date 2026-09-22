// node --test src/lib/callerMetrics.test.mjs
// The one canonical connect-rate formula — Reports Certification Phase 2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { connectRate } from "./callerMetrics.js";

test("zero calls never divides by zero", () => {
  assert.equal(connectRate(0, 0), 0);
});

test("zero calls with a nonsense connected count still returns 0 (total guards first)", () => {
  assert.equal(connectRate(0, 5), 0);
});

test("all calls connected -> 100", () => {
  assert.equal(connectRate(10, 10), 100);
});

test("no calls connected -> 0", () => {
  assert.equal(connectRate(10, 0), 0);
});

test("rounds to the nearest whole percent", () => {
  assert.equal(connectRate(3, 1), 33); // 33.33.. -> 33
  assert.equal(connectRate(3, 2), 67); // 66.66.. -> 67
});

test("coerces string-ish DB driver output the same way the route already relies on", () => {
  assert.equal(connectRate("10", "3"), 30);
});

test("negative/undefined inputs never throw or return NaN", () => {
  assert.equal(connectRate(undefined, undefined), 0);
  assert.equal(connectRate(-5, 2), 0);
});
