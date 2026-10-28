import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isUuid, parseText, parsePoints, parseEmail, parsePassword, parseLabel,
  parseQuestionForm, parseScoringMode, parseRevealMode,
  bangkokLocalToIso, isoToBangkokLocal, parseDuration, parseOptionalPercent, parseOptionalCount,
  parseOptionalDateTime, parseSessionForm,
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

test("Bangkok time conversion round-trips and rejects impossible dates", () => {
  assert.equal(bangkokLocalToIso("2026-10-28T09:30"), "2026-10-28T02:30:00.000Z");
  assert.equal(bangkokLocalToIso("2026-10-28T00:15"), "2026-10-27T17:15:00.000Z");
  assert.equal(isoToBangkokLocal("2026-10-27T17:15:00.000Z"), "2026-10-28T00:15");
  assert.equal(isoToBangkokLocal(null), "");
  assert.equal(bangkokLocalToIso("2026-02-31T10:00"), null);
  assert.equal(bangkokLocalToIso("2026-10-28T25:00"), null);
  assert.equal(bangkokLocalToIso("28/10/2026 09:30"), null);
  const iso = bangkokLocalToIso("2027-03-01T23:59")!;
  assert.equal(isoToBangkokLocal(iso), "2027-03-01T23:59");
});

test("session field parsers", () => {
  assert.deepEqual(parseDuration("15"), { ok: true, value: 15 });
  for (const bad of ["0", "601", "1.5", "", "abc"]) assert.equal(parseDuration(bad).ok, false, bad);
  assert.deepEqual(parseOptionalPercent(""), { ok: true, value: null });
  assert.deepEqual(parseOptionalPercent("60"), { ok: true, value: 60 });
  assert.equal(parseOptionalPercent("101").ok, false);
  assert.deepEqual(parseOptionalCount("", "x"), { ok: true, value: null });
  assert.deepEqual(parseOptionalCount("50", "x"), { ok: true, value: 50 });
  assert.equal(parseOptionalCount("-1", "x").ok, false);
  assert.deepEqual(parseOptionalDateTime("", "x"), { ok: true, value: null });
  assert.equal(parseOptionalDateTime("garbage", "x").ok, false);
});

test("parseSessionForm: draft vs live", () => {
  const SET = "3f2b8c1e-9d4a-4e6f-8a1b-2c3d4e5f6a7b";
  const base = {
    title: "รอบเช้า", reveal_mode: "immediate", closes_at: "", expected_participants: "30",
    set_id: SET, duration_minutes: "15", opens_at: "", pass_percent: "60", require_student_code: "on",
  };
  const d = parseSessionForm(form(base), true);
  assert.ok(d.ok);
  if (d.ok) {
    assert.equal(d.value.duration_minutes, 15);
    assert.equal(d.value.pass_percent, 60);
    assert.equal(d.value.require_student_code, true);
    assert.equal(d.value.closes_at, null);
    assert.equal(d.value.expected_participants, 30);
  }
  // live sessions never accept changes to duration / set / pass mark
  const l = parseSessionForm(form({ ...base, duration_minutes: "999", set_id: "bad" }), false);
  assert.ok(l.ok);
  if (l.ok) {
    assert.equal("duration_minutes" in l.value, false);
    assert.equal("set_id" in l.value, false);
    assert.equal("pass_percent" in l.value, false);
  }
  assert.equal(parseSessionForm(form({ ...base, title: " " }), true).ok, false);
  assert.equal(parseSessionForm(form({ ...base, set_id: "" }), true).ok, false);
  assert.equal(parseSessionForm(form({ ...base, duration_minutes: "0" }), true).ok, false);
  assert.equal(
    parseSessionForm(form({ ...base, opens_at: "2026-10-28T10:00", closes_at: "2026-10-28T09:00" }), true).ok,
    false,
  );
});
