import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterSortRows, summarize, formatBangkok, formatMinSec, csvCell, toCsv, safeFilename, exportRow,
  parseSortKey, parseSortDir, parseStatusFilter, EXPORT_HEADERS, type ResultRow,
} from "../lib/results-logic.ts";

const row = (no: number, p: Partial<ResultRow>): ResultRow => ({
  no, participantId: `p${no}`, firstName: `F${no}`, lastName: `L${no}`, studentCode: null,
  status: "submitted", startedAt: `2026-10-28T02:0${no}:00.000Z`, submittedAt: `2026-10-28T02:1${no}:00.000Z`,
  score: 5, maxScore: 10, percent: 50, correct: 5, wrong: 5, unanswered: 0, durationSeconds: 600, passed: null,
  ...p,
});

const rows: ResultRow[] = [
  row(1, { firstName: "สมชาย", lastName: "ใจดี", score: 8, percent: 80, durationSeconds: 400, passed: true }),
  row(2, { firstName: "สมหญิง", lastName: "รักเรียน", score: 3, percent: 30, durationSeconds: 900, passed: false, status: "timed_out" }),
  row(3, { firstName: "มานะ", lastName: "อดทน", studentCode: "A-77", status: "in_progress", submittedAt: null,
    score: null, maxScore: null, percent: null, correct: null, wrong: null, unanswered: null, durationSeconds: null, passed: null }),
  row(4, { firstName: "ปิติ", lastName: "ยินดี", score: 10, percent: 100, durationSeconds: 300, passed: true, status: "closed_by_admin" }),
];
const base = { q: "", status: "all" as const, sort: "started" as const, dir: "asc" as const };

test("search matches name, surname and student code, case-insensitively", () => {
  assert.deepEqual(filterSortRows(rows, { ...base, q: "สมหญิง" }).map((r) => r.no), [2]);
  assert.deepEqual(filterSortRows(rows, { ...base, q: "ใจดี" }).map((r) => r.no), [1]);
  assert.deepEqual(filterSortRows(rows, { ...base, q: "a-77" }).map((r) => r.no), [3]);
  assert.deepEqual(filterSortRows(rows, { ...base, q: "สม" }).map((r) => r.no), [1, 2]);
  assert.deepEqual(filterSortRows(rows, { ...base, q: "ไม่มีคนนี้" }), []);
});

test("status filters", () => {
  assert.deepEqual(filterSortRows(rows, { ...base, status: "in_progress" }).map((r) => r.no), [3]);
  assert.deepEqual(filterSortRows(rows, { ...base, status: "timed_out" }).map((r) => r.no), [2]);
  assert.deepEqual(filterSortRows(rows, { ...base, status: "passed" }).map((r) => r.no), [1, 4]);
  assert.deepEqual(filterSortRows(rows, { ...base, status: "failed" }).map((r) => r.no), [2]);
  assert.deepEqual(filterSortRows(rows, { ...base, status: "closed_by_admin" }).map((r) => r.no), [4]);
});

test("sorting by score/duration: unfinished attempts always last", () => {
  assert.deepEqual(filterSortRows(rows, { ...base, sort: "score", dir: "desc" }).map((r) => r.no), [4, 1, 2, 3]);
  assert.deepEqual(filterSortRows(rows, { ...base, sort: "score", dir: "asc" }).map((r) => r.no), [2, 1, 4, 3]);
  assert.deepEqual(filterSortRows(rows, { ...base, sort: "duration", dir: "asc" }).map((r) => r.no), [4, 1, 2, 3]);
  assert.deepEqual(filterSortRows(rows, { ...base, sort: "started", dir: "desc" }).map((r) => r.no), [4, 3, 2, 1]);
});

test("sorting by name uses Thai collation and is stable on ties", () => {
  const names = filterSortRows(rows, { ...base, sort: "name" }).map((r) => r.firstName);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "th")));
  const ties = [row(1, { percent: 50 }), row(2, { percent: 50 }), row(3, { percent: 50 })];
  assert.deepEqual(filterSortRows(ties, { ...base, sort: "percent", dir: "desc" }).map((r) => r.no), [1, 2, 3]);
});

test("summarize never counts unfinished attempts in averages", () => {
  const s = summarize(rows, 6);
  assert.equal(s.entered, 4);
  assert.equal(s.inProgress, 1);
  assert.equal(s.finished, 3);
  assert.equal(s.notStarted, 2);
  assert.equal(s.avgPercent, 70); // (80 + 30 + 100) / 3
  assert.equal(s.passedCount, 2);
  assert.equal(s.failedCount, 1);
  assert.equal(summarize(rows, null).notStarted, null);
  assert.equal(summarize(rows, 2).notStarted, 0);
  assert.equal(summarize([], 5).avgPercent, null);
});

test("time formatting in Bangkok time", () => {
  assert.equal(formatBangkok("2026-10-28T02:30:15.000Z"), "2026-10-28 09:30:15");
  assert.equal(formatBangkok("2026-10-27T17:00:00.000Z"), "2026-10-28 00:00:00");
  assert.equal(formatBangkok(null), "");
  assert.equal(formatMinSec(330), "05:30");
  assert.equal(formatMinSec(5), "00:05");
  assert.equal(formatMinSec(6030), "100:30");
  assert.equal(formatMinSec(null), "");
});

test("CSV escaping and formula-injection protection", () => {
  assert.equal(csvCell("สมชาย"), "สมชาย");
  assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell("=HYPERLINK(\"http://x\")"), '"\'=HYPERLINK(""http://x"")"');
  assert.equal(csvCell("+1+1"), "'+1+1");
  assert.equal(csvCell("-2"), "'-2");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(12.5), "12.5");
  assert.equal(csvCell(Number.NaN), "");
});

test("toCsv + exportRow keep unfinished attempts blank and label them", () => {
  const csv = toCsv(EXPORT_HEADERS, rows.map(exportRow));
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 5);
  assert.equal(lines[0].split(",").length, EXPORT_HEADERS.length);
  const inProg = exportRow(rows[2]);
  assert.equal(inProg[7], null); // score blank
  assert.equal(inProg[13], ""); // no pass/fail
  assert.equal(inProg[14], "กำลังสอบ (ยังไม่ส่ง)");
  assert.equal(exportRow(rows[0])[13], "ผ่าน");
  assert.equal(exportRow(rows[1])[13], "ไม่ผ่าน");
  assert.equal(exportRow(rows[0])[6], "06:40");
});

test("safeFilename and query parsers", () => {
  assert.equal(safeFilename('รอบเช้า: "A/B"?'), "รอบเช้า A B");
  assert.equal(safeFilename("///"), "export");
  assert.equal(parseSortKey("score"), "score");
  assert.equal(parseSortKey("drop table"), "started");
  assert.equal(parseSortDir("desc"), "desc");
  assert.equal(parseSortDir("x"), "asc");
  assert.equal(parseStatusFilter("passed"), "passed");
  assert.equal(parseStatusFilter("zzz"), "all");
});
