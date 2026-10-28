import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isUuid, parseText, parsePoints, parseEmail, parsePassword, parseLabel,
  parseQuestionForm, parseScoringMode, parseRevealMode,
} from "../lib/validation.ts";

const form = (o: Record<string, string>) => (k: string) => o[k] ?? null;

test("isUuid", () => {
  assert.equal(isUuid("3f2b8c1e-9d4a-4e6f-8a1b-2c3d4e5f6a7b"), true);
  assert.equal(isUuid("1; drop table"), false);
  assert.equal(isUuid(undefined), false);
});

test("parseText trims, requires, limits", () => {
  assert.deepEqual(parseText("  สวัสดี \r\n", 10, "x"), { ok: true, value: "สวัสดี" });
  assert.equal(parseText("   ", 10, "ชื่อ", true).ok, false);
  assert.equal(parseText("a".repeat(11), 10, "ชื่อ").ok, false);
  assert.equal(parseText(null, 10, "ชื่อ").ok, true);
});

test("parsePoints", () => {
  assert.deepEqual(parsePoints("2.5"), { ok: true, value: 2.5 });
  assert.deepEqual(parsePoints("1.236"), { ok: true, value: 1.24 });
  for (const bad of ["", "0", "-1", "abc", "1001", null, "Infinity"]) {
    assert.equal(parsePoints(bad).ok, false, String(bad));
  }
});

test("parseEmail / parsePassword", () => {
  assert.deepEqual(parseEmail(" A@B.co "), { ok: true, value: "a@b.co" });
  assert.equal(parseEmail("nope").ok, false);
  assert.equal(parsePassword("short").ok, false);
  assert.equal(parsePassword("0123456789").ok, true);
  assert.equal(parsePassword("x".repeat(73)).ok, false);
});

test("parseLabel / modes", () => {
  assert.equal(parseLabel("ข"), "ข");
  assert.equal(parseLabel("จ"), null);
  assert.equal(parseScoringMode("custom").ok, true);
  assert.equal(parseScoringMode("x").ok, false);
  assert.equal(parseRevealMode("hidden").ok, true);
  assert.equal(parseRevealMode("always").ok, false);
});

test("parseQuestionForm: custom needs points, equal ignores them", () => {
  const base = { body: "Q?", c0: "a", c1: "b", c2: "c", c3: "d", correct: "ค", explanation: "" };
  const custom = parseQuestionForm(form({ ...base, points: "3" }), "custom");
  assert.ok(custom.ok);
  if (custom.ok) {
    assert.equal(custom.value.points, 3);
    assert.equal(custom.value.correct, "ค");
    assert.equal(custom.value.explanation, null);
  }
  assert.equal(parseQuestionForm(form(base), "custom").ok, false);
  const equal = parseQuestionForm(form({ ...base, points: "999" }), "equal");
  assert.ok(equal.ok && equal.value.points === null);
});

test("parseQuestionForm allows incomplete drafts but not oversize text", () => {
  assert.ok(parseQuestionForm(form({}), "equal").ok);
  assert.equal(parseQuestionForm(form({ body: "x".repeat(2001) }), "equal").ok, false);
  assert.equal(parseQuestionForm(form({ c2: "x".repeat(501) }), "equal").ok, false);
});
