// node --test src/lib/taskGrouping.test.mjs
// Proves the ONE rule: date grouping is by task CREATION date; the due date
// (deadline) has zero influence — across every edge case in the spec.

import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTasksByCreatedThenUser, istDayKey } from "./taskGrouping.js";

// IST DD/MM/YYYY label, matching the app's formatDate for a YYYY-MM-DD key.
const fmt = (dk) => { const [y, m, d] = dk.split("-"); return `${d}/${m}/${y}`; };
const T = (id, created_at, deadline, uid, name) => ({ id, created_at, deadline, assigned_to_user_id: uid, assignee_name: name });

test("spec §3: same created date, different due dates → one date group", () => {
  const g = groupTasksByCreatedThenUser([
    T("A", "2026-09-05T09:00:00Z", "2026-09-10", 1, "Aakash"),
    T("B", "2026-09-05T10:00:00Z", "2026-09-20", 1, "Aakash"),
    T("C", "2026-09-05T11:00:00Z", "2026-09-08", 2, "Rahul"),
    T("D", "2026-09-06T09:00:00Z", "2026-09-15", 2, "Rahul"),
  ], fmt);
  assert.equal(g.length, 2);
  assert.equal(g[0].label, "06/09/2026");   // newest first
  assert.equal(g[1].label, "05/09/2026");
  const sep5 = g[1];
  assert.equal(sep5.total, 3);
  assert.deepEqual(sep5.users.map((u) => u.name), ["Aakash", "Rahul"]);
  assert.deepEqual(sep5.users[0].tasks.map((t) => t.id), ["A", "B"]);
  assert.deepEqual(sep5.users[1].tasks.map((t) => t.id), ["C"]);
  assert.deepEqual(g[0].users[0].tasks.map((t) => t.id), ["D"]); // under 06 Sep, not its 15 Sep due date
});

test("far-future due date never moves a task out of its creation-date group", () => {
  const g = groupTasksByCreatedThenUser([T("X", "2026-09-05T08:00:00Z", "2026-12-31", 1, "Aakash")], fmt);
  assert.equal(g[0].label, "05/09/2026");
});

test("different created dates + same due date → separate date groups", () => {
  const g = groupTasksByCreatedThenUser([
    T("P", "2026-09-04T08:00:00Z", "2026-09-30", 1, "Aakash"),
    T("Q", "2026-09-05T08:00:00Z", "2026-09-30", 1, "Aakash"),
  ], fmt);
  assert.deepEqual(g.map((d) => d.label), ["05/09/2026", "04/09/2026"]);
});

test("due-date change / removal never moves the group (grouping ignores deadline)", () => {
  const a = groupTasksByCreatedThenUser([T("E", "2026-09-05T08:00:00Z", "2026-09-10", 1, "Aakash")], fmt);
  const b = groupTasksByCreatedThenUser([T("E", "2026-09-05T08:00:00Z", "2026-09-25", 1, "Aakash")], fmt);
  const c = groupTasksByCreatedThenUser([T("E", "2026-09-05T08:00:00Z", null, 1, "Aakash")], fmt);
  assert.equal(a[0].label, "05/09/2026");
  assert.equal(b[0].label, "05/09/2026");
  assert.equal(c[0].label, "05/09/2026");
});

test("a task with NO due date still groups by its creation date", () => {
  const g = groupTasksByCreatedThenUser([T("N", "2026-09-05T08:00:00Z", null, 3, "Priya")], fmt);
  assert.equal(g[0].label, "05/09/2026");
  assert.equal(g[0].users[0].tasks.length, 1);
});

test("same user + same created date → one user group with all tasks (Paste-Task shape)", () => {
  const g = groupTasksByCreatedThenUser([
    T("1", "2026-09-05T06:00:00Z", "2026-09-06", 7, "Sana"),
    T("2", "2026-09-05T07:00:00Z", "2026-09-10", 7, "Sana"),
    T("3", "2026-09-05T08:00:00Z", "2026-09-20", 7, "Sana"),
  ], fmt);
  assert.equal(g.length, 1);
  assert.equal(g[0].users.length, 1);
  assert.equal(g[0].users[0].tasks.length, 3);
});

test("team + unassigned group by id; same-named users never merge", () => {
  const g = groupTasksByCreatedThenUser([
    { id: "u", created_at: "2026-09-05T06:00:00Z", assigned_to_user_id: null, assigned_to_team_id: null },
    { id: "t", created_at: "2026-09-05T06:00:00Z", assigned_to_team_id: 4, team_name: "Field Team" },
    { id: "z1", created_at: "2026-09-05T06:00:00Z", assigned_to_user_id: 9, assignee_name: "Ravi" },
    { id: "z2", created_at: "2026-09-05T06:00:00Z", assigned_to_user_id: 10, assignee_name: "Ravi" },
  ], fmt);
  const users = g[0].users;
  assert.equal(users.length, 4); // two "Ravi" (ids 9 & 10) stay separate + team + unassigned = 4
  const keys = users.map((u) => u.key).sort();
  assert.deepEqual(keys, ["t:4", "u:10", "u:9", "unassigned"].sort());
  assert.ok(users.find((u) => u.key === "t:4").isTeam);
  assert.ok(users.find((u) => u.key === "unassigned").unassigned);
});

test("IST midnight boundary: a UTC time past IST midnight counts as the next IST day", () => {
  assert.equal(istDayKey("2026-09-05T19:00:00Z"), "2026-09-06"); // 00:30 IST on 06 Sep
  const g = groupTasksByCreatedThenUser([T("m", "2026-09-05T19:00:00Z", "2026-09-05", 1, "Aakash")], fmt);
  assert.equal(g[0].label, "06/09/2026");
});

test("falls back to assigned_at when created_at is absent — never to deadline", () => {
  const g = groupTasksByCreatedThenUser([
    { id: "f", created_at: null, assigned_at: "2026-09-05T08:00:00Z", deadline: "2026-09-30", assigned_to_user_id: 1, assignee_name: "Aakash" },
  ], fmt);
  assert.equal(g[0].label, "05/09/2026"); // 05 Sep (assigned_at), not 30 Sep (deadline)
});
