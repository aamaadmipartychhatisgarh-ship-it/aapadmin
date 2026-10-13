import test from "node:test";
import assert from "node:assert/strict";
import { verifyOtpChallenge } from "./workerFormOtpVerifyCore.js";

// In-memory stand-in for the worker_form_otps table. Each statement yields to the
// event loop first, so Promise.all() interleaves requests the way a real pool
// does — the old read-then-write code fails these tests, the atomic one passes.
function fakeDb(row) {
  const r = { attempts: 0, consumed_at: null, ...row };
  const tick = () => new Promise((res) => setImmediate(res));
  const query = async (sql, params) => {
    await tick();
    if (sql.startsWith("SELECT")) return r.consumed_at ? [] : [{ ...r }];
    if (sql.includes("SET attempts = attempts + 1")) {
      const [, max] = params;
      if (r.consumed_at || r.attempts >= max) return { affectedRows: 0 };
      r.attempts += 1;
      return { affectedRows: 1 };
    }
    if (sql.includes("SET consumed_at = NOW()")) {
      if (r.consumed_at) return { affectedRows: 0 };
      r.consumed_at = new Date();
      return { affectedRows: 1 };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  return { r, query };
}
const otpMatches = (otp) => otp === "123456";
const live = () => ({ id: 1, worker_id: 7, otp_hash: "h", expires_at: new Date(Date.now() + 60000) });
const run = (query, otp) => verifyOtpChallenge({ query, otpMatches, key: "9876543210", otp, maxAttempts: 5 });

test("correct OTP succeeds once and is consumed", async () => {
  const { r, query } = fakeDb(live());
  const v = await run(query, "123456");
  assert.equal(v.ok, true);
  assert.equal(v.row.worker_id, 7);
  assert.ok(r.consumed_at);
  assert.equal((await run(query, "123456")).status, 400); // replay rejected
});

test("wrong OTP is rejected and counted", async () => {
  const { r, query } = fakeDb(live());
  const v = await run(query, "000000");
  assert.deepEqual([v.ok, v.status], [undefined, 400]);
  assert.equal(r.attempts, 1);
});

test("expired OTP is rejected without spending an attempt", async () => {
  const { r, query } = fakeDb({ ...live(), expires_at: new Date(Date.now() - 1) });
  assert.equal((await run(query, "123456")).status, 400);
  assert.equal(r.attempts, 0);
});

test("lockout after 5 attempts even for the correct OTP", async () => {
  const { query } = fakeDb(live());
  for (let i = 0; i < 5; i++) assert.equal((await run(query, "000000")).status, 400);
  assert.equal((await run(query, "123456")).status, 429);
});

test("parallel brute force cannot exceed the attempt budget", async () => {
  const { r, query } = fakeDb(live());
  const guesses = Array.from({ length: 200 }, (_, i) => String(i).padStart(6, "0"));
  guesses.push("123456"); // the right code is in the batch, past the budget
  const results = await Promise.all(guesses.map((g) => run(query, g)));
  assert.equal(r.attempts, 5);
  assert.equal(results.filter((x) => x.ok).length, 0);
  assert.equal(results.filter((x) => x.status === 429).length, guesses.length - 5);
});

test("parallel correct submissions mint exactly one session", async () => {
  const { query } = fakeDb(live());
  const results = await Promise.all(Array.from({ length: 4 }, () => run(query, "123456")));
  assert.equal(results.filter((x) => x.ok).length, 1);
});
