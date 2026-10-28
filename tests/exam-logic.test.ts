import { test } from "node:test";
import assert from "node:assert/strict";
import { formatClock, timerLevel, remainingFrom, nextSeq, mergeAnswers, formatDuration } from "../lib/exam-logic.ts";

test("formatClock rounds up and never goes negative", () => {
  assert.equal(formatClock(600_000), "10:00");
  assert.equal(formatClock(330_000), "05:30");
  assert.equal(formatClock(30_000), "00:30");
  assert.equal(formatClock(29_001), "00:30");
  assert.equal(formatClock(1), "00:01");
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(-5000), "00:00");
  assert.equal(formatClock(100 * 60_000), "100:00");
});

test("timerLevel thresholds", () => {
  assert.equal(timerLevel(10 * 60_000), "normal");
  assert.equal(timerLevel(300_001), "normal");
  assert.equal(timerLevel(300_000), "warn");
  assert.equal(timerLevel(60_001), "warn");
  assert.equal(timerLevel(60_000), "danger");
  assert.equal(timerLevel(0), "danger");
});

test("remainingFrom uses server times, not the client clock", () => {
  const deadline = "2026-10-28T10:15:00.000Z";
  assert.equal(remainingFrom(deadline, "2026-10-28T10:10:00.000Z", 0), 300_000);
  assert.equal(remainingFrom(deadline, "2026-10-28T10:10:00.000Z", 400), 299_800);
  assert.equal(remainingFrom(deadline, "2026-10-28T10:16:00.000Z", 0), 0);
  assert.equal(remainingFrom("garbage", "2026-10-28T10:16:00.000Z", 0), 0);
});

test("nextSeq keeps growing across refreshes and backwards clocks", () => {
  assert.equal(nextSeq(0, 0, 1_700_000_000_000), 1_700_000_000_000);
  assert.equal(nextSeq(1_700_000_000_005, 0, 1_700_000_000_001), 1_700_000_000_006);
  // clock moved back: server already saw a bigger seq
  assert.equal(nextSeq(0, 1_800_000_000_000, 1_700_000_000_000), 1_800_000_000_001);
});

test("mergeAnswers: server wins except unsaved local changes", () => {
  const unsaved = new Map<string, { label: string | null }>([["q2", { label: "ค" }], ["q3", { label: null }]]);
  assert.deepEqual(
    mergeAnswers({ q1: "ก", q2: "ข", q3: "ง" }, unsaved),
    { q1: "ก", q2: "ค" },
  );
  assert.deepEqual(mergeAnswers({}, new Map()), {});
});

test("formatDuration", () => {
  assert.equal(formatDuration(0), "0 วินาที");
  assert.equal(formatDuration(45), "45 วินาที");
  assert.equal(formatDuration(330), "5 นาที 30 วินาที");
  assert.equal(formatDuration(600), "10 นาที 0 วินาที");
});
