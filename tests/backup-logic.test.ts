import { test } from "node:test";
import assert from "node:assert/strict";
import { backupChunks, checkBackup, BACKUP_TABLES, BACKUP_PAGE, type FetchPage } from "../lib/backup-logic.ts";

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let s = "";
  for await (const c of gen) s += c;
  return s;
}
const fakeDb = (sizes: Record<string, number>, log: string[] = []): FetchPage => async (table, order, from, to) => {
  log.push(`${table}:${order.join("+")}:${from}-${to}`);
  const total = sizes[table] ?? 0;
  const rows: unknown[] = [];
  for (let i = from; i <= to && i < total; i++) rows.push({ id: `${table}-${i}`, text: `ข้อความ ${i} "quote" \\ \n newline` });
  return { rows, error: null };
};

test("backup is valid JSON, tables in foreign-key order, counts correct (empty and paged)", async () => {
  const empty = JSON.parse(await collect(backupChunks("2026-10-30T00:00:00.000Z", fakeDb({}))));
  assert.equal(empty.format, "exam-app-backup");
  assert.deepEqual(Object.keys(empty.tables), BACKUP_TABLES.map((t) => t.name));
  assert.ok(checkBackup(empty).ok);

  const log: string[] = [];
  const sizes = { question_sets: 3, participant_answers: 2500, exam_results: BACKUP_PAGE };
  const full = JSON.parse(await collect(backupChunks("t", fakeDb(sizes, log))));
  assert.equal(full.tables.participant_answers.length, 2500);
  assert.equal(full.tables.question_sets.length, 3);
  assert.equal(full.tables.exam_results.length, BACKUP_PAGE);
  assert.deepEqual(full.counts, { question_sets: 3, questions: 0, answer_choices: 0, exam_sessions: 0, session_questions: 0,
    session_choices: 0, exam_participants: 0, participant_answers: 2500, exam_results: BACKUP_PAGE });
  // special characters survive
  assert.equal(full.tables.question_sets[0].text, 'ข้อความ 0 "quote" \\ \n newline');
  // an exact multiple of the page size needs one extra (empty) page to know it is finished
  assert.ok(log.includes(`exam_results:participant_id:${BACKUP_PAGE}-${2 * BACKUP_PAGE - 1}`));
  // composite primary keys are used for stable paging
  assert.ok(log.some((l) => l.startsWith("participant_answers:participant_id+session_question_id:")));
  assert.ok(checkBackup(full).ok);
});

test("a failure mid-way aborts the stream and never yields a valid-looking file", async () => {
  const failing: FetchPage = async (table, _o, from) =>
    table === "exam_sessions" ? { rows: [], error: "boom" } : { rows: from === 0 ? [{ id: "x" }] : [], error: null };
  let text = "";
  await assert.rejects(async () => { for await (const c of backupChunks("t", failing)) text += c; }, /backup failed at exam_sessions: boom/);
  assert.throws(() => JSON.parse(text)); // truncated => not parseable
});

test("checkBackup rejects foreign, wrong-version, incomplete and tampered files", () => {
  const good = { format: "exam-app-backup", version: 1, created_at: "t",
    tables: Object.fromEntries(BACKUP_TABLES.map((t) => [t.name, []])),
    counts: Object.fromEntries(BACKUP_TABLES.map((t) => [t.name, 0])) };
  assert.ok(checkBackup(good).ok);
  assert.equal(checkBackup(null).ok, false);
  assert.equal(checkBackup({ ...good, format: "other" }).ok, false);
  assert.equal(checkBackup({ ...good, version: 2 }).ok, false);
  assert.equal(checkBackup({ ...good, tables: { ...good.tables, questions: undefined } }).ok, false);
  assert.equal(checkBackup({ ...good, tables: { ...good.tables, questions: [{ id: 1 }] } }).ok, false); // count mismatch
  const { counts: _c, ...noCounts } = good;
  assert.equal(checkBackup(noCounts).ok, false); // truncated file has no trailer
});
