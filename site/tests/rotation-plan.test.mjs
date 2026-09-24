import assert from "node:assert/strict";
import test from "node:test";
import {
  planDailyRotation, planManualRedeploy, ROTATION_DAYS, rotationWindow,
} from "../lib/rotation-plan.mjs";

const agents = ["agent-4", "agent-3", "agent-2", "agent-1"];
const atTaipei = (day, time) => Date.parse(`${day}T${time}:00+08:00`);

test("switches every eight hours at 04:00, 12:00 and 20:00 Taipei", () => {
  const checks = [
    ["03:59", "2026-09-24-americas", "americas"],
    ["04:00", "2026-09-25-asia", "asia"],
    ["11:59", "2026-09-25-asia", "asia"],
    ["12:00", "2026-09-25-emea", "emea"],
    ["19:59", "2026-09-25-emea", "emea"],
    ["20:00", "2026-09-25-americas", "americas"],
  ];
  for (const [time, scheduleDate, slot] of checks) {
    const window = rotationWindow(atTaipei("2026-09-25", time));
    assert.equal(window.scheduleDate, scheduleDate);
    assert.equal(window.slot, slot);
  }
  const start = rotationWindow(atTaipei("2026-09-25", "04:00"));
  assert.equal(start.nextSwitchAt - atTaipei("2026-09-25", "04:00"), 8 * 3_600_000);
});

test("the one-time early EMEA window expires at noon and never recurs", () => {
  const early = rotationWindow(atTaipei("2026-09-24", "10:30"));
  assert.equal(early.slot, "emea");
  assert.equal(early.earlyPreview, true);
  assert.equal(early.nextSwitchAt, atTaipei("2026-09-24", "20:00"));
  assert.equal(rotationWindow(atTaipei("2026-09-25", "10:30")).slot, "asia");
});

test("covers every selected regional pack exactly once without Taiwan or Japan", () => {
  assert.equal(ROTATION_DAYS.length, 3);
  const all = new Set();
  for (const slot of ROTATION_DAYS) {
    const seen = new Set();
    assert.equal(slot.length, 4);
    for (const route of slot) {
      assert.ok(route.cityCount > 0);
      for (const pack of route.packs) {
        assert.equal(seen.has(pack), false, `${pack} repeats within a slot`);
        assert.equal(all.has(pack), false, `${pack} repeats across slots`);
        seen.add(pack); all.add(pack);
      }
    }
  }
  assert.equal(all.size, 67);
  assert.equal(all.has("tw"), false);
  assert.equal(all.has("jp"), false);
  for (const pack of ["in", "au", "nz", "ae", "gb", "de", "it", "es", "fr",
    "se", "is", "eg", "ma", "us-east", "us-central", "us-west", "mx", "br", "ca"])
    assert.equal(all.has(pack), true, `${pack} is missing`);
});

test("all three slots pass the local-day guard in summer and winter", () => {
  for (const day of ["2026-09-25", "2027-01-15"]) {
    for (const [time, slot] of [["04:00", "asia"], ["12:00", "emea"], ["20:00", "americas"]]) {
      const plan = planDailyRotation(agents, atTaipei(day, time));
      assert.equal(plan.slot, slot);
      assert.equal(plan.assignments.length, 4);
      assert.equal(new Set(plan.assignments.map((item) => item.id)).size, 4);
      assert.ok(plan.assignments.every((item) => item.id.startsWith(slot)));
    }
  }
});

test("a paused fourth Agent does not drop a quarter of the world", () => {
  for (const [time, slotIndex] of [["04:00", 0], ["12:00", 1], ["20:00", 2]]) {
    const plan = planDailyRotation(agents.slice(0, 3), atTaipei("2026-09-25", time));
    const expected = new Set(ROTATION_DAYS[slotIndex].flatMap((route) => route.packs));
    const assigned = plan.assignments.flatMap((route) => route.packs);
    assert.deepEqual(new Set(assigned), expected);
    assert.equal(assigned.length, expected.size);
    const counts = plan.assignments.map((route) => route.cityCount);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 12);
  }
});

test("manual redeploy stays in the eligible region and changes Agent order", () => {
  const now = atTaipei("2026-09-25", "13:00");
  const current = planDailyRotation(agents, now);
  const manual = planManualRedeploy(agents, now);
  assert.equal(manual.slot, "emea");
  assert.equal(manual.nextSwitchAt, current.nextSwitchAt);
  assert.deepEqual(new Set(manual.assignments.flatMap((item) => item.packs)),
    new Set(current.assignments.flatMap((item) => item.packs)));
  assert.notEqual(manual.assignments[0].packs.join(), current.assignments[0].packs.join());
});

test("the next day reverses route ownership between Agents", () => {
  const first = planDailyRotation(agents, atTaipei("2026-09-25", "12:00"));
  const second = planDailyRotation(agents, atTaipei("2026-09-26", "12:00"));
  assert.equal(first.assignments[0].id, second.assignments[3].id);
  assert.equal(first.assignments[3].id, second.assignments[0].id);
});
