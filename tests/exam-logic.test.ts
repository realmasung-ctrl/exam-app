import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatClock, timerLevel, remainingFrom, nextSeq, mergeAnswers, formatDuration, canReveal, buildReview,
} from "../lib/exam-logic.ts";

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

test("canReveal follows the admin's reveal mode", () => {
  for (const st of ["open", "running", "ended", "disabled"]) {
    assert.equal(canReveal("immediate", st), true, `immediate/${st}`);
    assert.equal(canReveal("hidden", st), false, `hidden/${st}`);
  }
  assert.equal(canReveal("after_close", "open"), false);
  assert.equal(canReveal("after_close", "running"), false);
  assert.equal(canReveal("after_close", "ended"), true);
  assert.equal(canReveal("after_close", "disabled"), true);
  assert.equal(canReveal("something-else", "ended"), false); // unknown value fails closed
});

test("buildReview marks correct / wrong / unanswered and keeps both answers visible", () => {
  const mk = (id: string, position: number, correct: string, explanation: string | null) => ({
    id, position, body: `Q${position}`, explanation,
    // deliberately unsorted to prove ordering is applied
    choices: ["ค", "ก", "ง", "ข"].map((label) => ({ label, body: `opt-${label}`, is_correct: label === correct })),
  });
  const review = buildReview(
    [mk("q3", 3, "ง", "  "), mk("q1", 1, "ก", "เพราะ..."), mk("q2", 2, "ข", null)],
    { q1: "ก", q2: "ค" },
  );
  assert.deepEqual(review.map((r) => r.position), [1, 2, 3]);
  assert.deepEqual(review.map((r) => r.status), ["correct", "wrong", "unanswered"]);
  assert.deepEqual(review[0].choices.map((c) => c.label), ["ก", "ข", "ค", "ง"]);
  assert.equal(review[0].explanation, "เพราะ...");
  assert.equal(review[2].explanation, null); // blank explanation is treated as none
  // wrong answer: both my choice and the right one are flagged
  assert.equal(review[1].myLabel, "ค");
  assert.equal(review[1].correctLabel, "ข");
  assert.deepEqual(review[1].choices.filter((c) => c.isMine).map((c) => c.label), ["ค"]);
  assert.deepEqual(review[1].choices.filter((c) => c.isCorrect).map((c) => c.label), ["ข"]);
  // unanswered: nobody is marked as "mine"
  assert.equal(review[2].myLabel, null);
  assert.equal(review[2].choices.some((c) => c.isMine), false);
});
