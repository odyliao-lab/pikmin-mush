import assert from "node:assert/strict";
import test from "node:test";
import {
  planDailyRotation, ROTATION_DAYS, rotationWindow,
} from "../lib/rotation-plan.mjs";

test("switches the effective schedule at 07:30 Asia/Taipei", () => {
  const before = rotationWindow(Date.parse("2026-07-22T23:29:59Z"));
  const after = rotationWindow(Date.parse("2026-07-22T23:30:00Z"));
  assert.equal(before.scheduleDate, "2026-07-22");
  assert.equal(after.scheduleDate, "2026-07-23");
  assert.equal(before.nextSwitchAt, Date.parse("2026-07-22T23:30:00Z"));
});

test("assigns three Agents distinct balanced routes and covers all packs in five days", () => {
  const seenBundles = new Set();
  const seenPacks = new Set();
  for (let day = 0; day < ROTATION_DAYS.length; day += 1) {
    const now = Date.parse(`2026-07-${String(22 + day).padStart(2, "0")}T00:00:00Z`);
    const plan = planDailyRotation(["agent-3", "agent-2", "agent-1"], now);
    assert.equal(plan.assignments.length, 3);
    assert.notEqual(plan.assignments[0].id, plan.assignments[1].id);
    assert.notEqual(plan.assignments[1].id, plan.assignments[2].id);
    const counts = plan.assignments.map((item) => item.cityCount);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 2);
    assert.ok(Math.min(...counts) >= 27);
    for (const assignment of plan.assignments) {
      seenBundles.add(assignment.id);
      for (const pack of assignment.packs) {
        assert.equal(seenPacks.has(pack), false, `${pack} was assigned twice in one cycle`);
        seenPacks.add(pack);
      }
    }
  }
  assert.equal(seenBundles.size, 15);
  assert.equal(seenPacks.size, 68);
});

test("reverses the three routes between Agents on the next cycle", () => {
  const first = planDailyRotation(
    ["agent-1", "agent-2", "agent-3"],
    Date.parse("2026-07-22T00:00:00Z"),
  );
  const nextCycle = planDailyRotation(
    ["agent-1", "agent-2", "agent-3"],
    Date.parse("2026-07-27T00:00:00Z"),
  );
  assert.equal(first.assignments[0].id, nextCycle.assignments[2].id);
  assert.equal(first.assignments[1].id, nextCycle.assignments[1].id);
  assert.equal(first.assignments[2].id, nextCycle.assignments[0].id);
});
