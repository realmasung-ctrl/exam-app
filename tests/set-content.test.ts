import { test } from "node:test";
import assert from "node:assert/strict";
import {
  problemsFor, totalPoints, blankQuestion, parseSaveInput, parseBulkQuestions, type EditorQuestion,
} from "../lib/set-content.ts";

const ID1 = "3f2b8c1e-9d4a-4e6f-8a1b-2c3d4e5f6a7b";
const ID2 = "4a2b8c1e-9d4a-4e6f-8a1b-2c3d4e5f6a7c";
const full = (id: string, over: Partial<EditorQuestion> = {}): EditorQuestion => ({
  id, body: "Q?", explanation: "", points: "2", choices: ["a", "b", "c", "d"], correct: "ข", ...over,
});
const settings = { title: "ชุด", instructions: "", scoring_mode: "equal", equal_points: "1", default_reveal_mode: "hidden" };

test("problemsFor mirrors the database rules", () => {
  assert.deepEqual(problemsFor(full(ID1), "equal"), []);
  assert.deepEqual(problemsFor(blankQuestion(ID1), "equal"), ["ยังไม่ได้กรอกคำถาม", "ตัวเลือกยังว่าง: ก ข ค ง", "ยังไม่ได้เลือกเฉลย"]);
  assert.deepEqual(problemsFor(full(ID1, { choices: ["a", "  ", "c", "d"] }), "equal"), ["ตัวเลือกยังว่าง: ข"]);
  assert.deepEqual(problemsFor(full(ID1, { correct: null }), "equal"), ["ยังไม่ได้เลือกเฉลย"]);
  assert.deepEqual(problemsFor(full(ID1, { points: "0" }), "custom"), ["คะแนนต้องมากกว่า 0 และไม่เกิน 1000"]);
  assert.deepEqual(problemsFor(full(ID1, { points: "" }), "custom").length, 1);
  assert.deepEqual(problemsFor(full(ID1, { points: "0" }), "equal"), []); // points ignored in equal mode
});

test("totalPoints for both scoring modes", () => {
  const qs = [full(ID1, { points: "1" }), full(ID2, { points: "2.5" })];
  assert.equal(totalPoints(qs, { scoring_mode: "equal", equal_points: "3" }), 6);
  assert.equal(totalPoints(qs, { scoring_mode: "custom", equal_points: "3" }), 3.5);
  assert.equal(totalPoints([], { scoring_mode: "equal", equal_points: "3" }), 0);
  assert.equal(totalPoints(qs, { scoring_mode: "equal", equal_points: "abc" }), 0);
});

test("parseSaveInput accepts a valid payload and normalises it", () => {
  const r = parseSaveInput({ settings, questions: [full(ID1, { body: "  Q  \r\n x ", correct: "ก" }), full(ID2)] });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.questions.length, 2);
    assert.equal(r.value.questions[0].body, "Q  \n x");
    assert.equal(r.value.questions[0].points, null); // equal mode: per-question points ignored
    assert.equal(r.value.settings.equal_points, 1);
    assert.equal(r.value.questions[0].id, ID1);
  }
  const custom = parseSaveInput({ settings: { ...settings, scoring_mode: "custom" }, questions: [full(ID1, { points: "2.555" })] });
  assert.ok(custom.ok && custom.value.questions[0].points === 2.56);
});

test("parseSaveInput rejects malformed or hostile input", () => {
  const bad = (raw: unknown) => assert.equal(parseSaveInput(raw).ok, false, JSON.stringify(raw)?.slice(0, 80));
  bad(null); bad("x"); bad({}); bad({ settings, questions: "nope" }); bad({ settings: null, questions: [] });
  bad({ settings: { ...settings, title: "  " }, questions: [] });
  bad({ settings: { ...settings, title: "x".repeat(201) }, questions: [] });
  bad({ settings: { ...settings, scoring_mode: "weird" }, questions: [] });
  bad({ settings: { ...settings, default_reveal_mode: "always" }, questions: [] });
  bad({ settings: { ...settings, equal_points: "0" }, questions: [] });
  bad({ settings, questions: [full("not-a-uuid")] });
  bad({ settings, questions: [full(ID1), full(ID1)] });
  bad({ settings, questions: [full(ID1, { body: "x".repeat(2001) })] });
  bad({ settings, questions: [full(ID1, { explanation: "x".repeat(2001) })] });
  bad({ settings, questions: [{ ...full(ID1), choices: ["a", "b", "c"] }] });
  bad({ settings, questions: [{ ...full(ID1), choices: ["a", "b", "c", "x".repeat(501)] }] });
  bad({ settings, questions: [{ ...full(ID1), correct: "จ" }] });
  bad({ settings: { ...settings, scoring_mode: "custom" }, questions: [full(ID1, { points: "-1" })] });
  bad({ settings, questions: Array.from({ length: 501 }, (_, i) => full(`3f2b8c1e-9d4a-4e6f-8a1b-${String(i).padStart(12, "0")}`)) });
  // incomplete drafts are fine: completeness is checked when the session is opened
  assert.ok(parseSaveInput({ settings, questions: [blankQuestion(ID1)] }).ok);
});

test("bulk paste: numbered questions with Thai labels", () => {
  const text = `1. เมืองหลวงของไทยคือ?
ก. เชียงใหม่
ข. กรุงเทพฯ
ค. ภูเก็ต
ง. ขอนแก่น
เฉลย: ข
คำอธิบาย: กรุงเทพมหานครเป็นเมืองหลวง

2. 2 + 2 = ?
ก. 3
ข. 4
ค. 5
ง. 6
ตอบ ข`;
  const r = parseBulkQuestions(text);
  assert.equal(r.warnings.length, 0, r.warnings.join("|"));
  assert.equal(r.questions.length, 2);
  assert.equal(r.questions[0].body, "เมืองหลวงของไทยคือ?");
  assert.deepEqual(r.questions[0].choices, ["เชียงใหม่", "กรุงเทพฯ", "ภูเก็ต", "ขอนแก่น"]);
  assert.equal(r.questions[0].correct, "ข");
  assert.equal(r.questions[0].explanation, "กรุงเทพมหานครเป็นเมืองหลวง");
  assert.equal(r.questions[1].correct, "ข");
});

test("bulk paste: Latin letters, Thai digits, 'ข้อ' prefix, answer by number", () => {
  const r = parseBulkQuestions(`ข้อ ๑. Capital of France?
A. Paris
B. Rome
C. Madrid
D. Berlin
Answer: A

ข้อ ๒) Largest planet?
a) Earth
b) Jupiter
c) Mars
d) Venus
เฉลย 2`);
  assert.equal(r.warnings.length, 0, r.warnings.join("|"));
  assert.equal(r.questions.length, 2);
  assert.equal(r.questions[0].correct, "ก");
  assert.equal(r.questions[0].body, "Capital of France?");
  assert.equal(r.questions[1].correct, "ข");
  assert.equal(r.questions[1].choices[1], "Jupiter");
});

test("bulk paste: unnumbered questions separated by blank lines, multi-line text", () => {
  const r = parseBulkQuestions(`คำถามแรกยาว
ต่อบรรทัดสอง
ก. ตอบ 1
   ต่อบรรทัดของตัวเลือก
ข. ตอบ 2
ค. ตอบ 3
ง. ตอบ 4
เฉลย: ก

คำถามที่สอง
ก. a
ข. b
ค. c
ง. d
เฉลย: ง`);
  assert.equal(r.warnings.length, 0, r.warnings.join("|"));
  assert.equal(r.questions.length, 2);
  assert.equal(r.questions[0].body, "คำถามแรกยาว\nต่อบรรทัดสอง");
  assert.equal(r.questions[0].choices[0], "ตอบ 1\nต่อบรรทัดของตัวเลือก");
  assert.equal(r.questions[1].body, "คำถามที่สอง");
  assert.equal(r.questions[1].correct, "ง");
});

test("bulk paste: problems become warnings but questions are kept", () => {
  const r = parseBulkQuestions(`ก. ตัวเลือกลอย
1. ขาดเฉลยและตัวเลือก
ก. a
ข. b`);
  assert.equal(r.questions.length, 1);
  assert.ok(r.warnings.some((w) => w.includes("ก่อนคำถาม")));
  assert.ok(r.warnings.some((w) => w.includes("ไม่พบเฉลย")));
  assert.ok(r.warnings.some((w) => w.includes("ตัวเลือกไม่ครบ")));
  assert.deepEqual(parseBulkQuestions("   \n\n"), { questions: [], warnings: [] });
});

test("bulk paste: question that merely contains a number or a colon is not split", () => {
  const r = parseBulkQuestions(`1. ราคา 3.5 บาท เวลา 10:30 น. ใช่หรือไม่
ก. ใช่
ข. ไม่ใช่
ค. บางครั้ง
ง. ไม่ทราบ
เฉลย: ก`);
  assert.equal(r.questions.length, 1);
  assert.equal(r.warnings.length, 0, r.warnings.join("|"));
  assert.equal(r.questions[0].body, "ราคา 3.5 บาท เวลา 10:30 น. ใช่หรือไม่");
});
