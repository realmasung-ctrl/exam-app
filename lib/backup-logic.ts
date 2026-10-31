// Pure logic for the full-data backup file (no imports -> unit-testable with node --test).

export const BACKUP_FORMAT = "exam-app-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_PAGE = 1000; // PostgREST returns at most 1000 rows per request

/** Order matters: parents before children, so a restore never violates a foreign key. */
export const BACKUP_TABLES = [
  { name: "question_sets", pk: ["id"] },
  { name: "questions", pk: ["id"] },
  { name: "answer_choices", pk: ["id"] },
  { name: "exam_sessions", pk: ["id"] },
  { name: "session_questions", pk: ["id"] },
  { name: "session_choices", pk: ["id"] },
  { name: "exam_participants", pk: ["id"] },
  { name: "participant_answers", pk: ["participant_id", "session_question_id"] },
  { name: "exam_results", pk: ["participant_id"] },
] as const;

export type FetchPage = (
  table: string, order: readonly string[], from: number, to: number,
) => Promise<{ rows: unknown[]; error: string | null }>;

/** Streams the backup as JSON text, one database page at a time (never holds the whole file in memory).
 *  A failure throws, which aborts the download: a half-written file is NOT valid JSON, so it can never be
 *  mistaken for a good backup. */
export async function* backupChunks(createdAt: string, fetchPage: FetchPage): AsyncGenerator<string> {
  const counts: Record<string, number> = {};
  yield `{"format":${JSON.stringify(BACKUP_FORMAT)},"version":${BACKUP_VERSION},"created_at":${JSON.stringify(createdAt)},"tables":{`;

  for (let t = 0; t < BACKUP_TABLES.length; t++) {
    const { name, pk } = BACKUP_TABLES[t];
    yield `${t > 0 ? "," : ""}${JSON.stringify(name)}:[`;
    let n = 0;
    for (let from = 0; ; from += BACKUP_PAGE) {
      const { rows, error } = await fetchPage(name, pk, from, from + BACKUP_PAGE - 1);
      if (error !== null) throw new Error(`backup failed at ${name}: ${error}`);
      if (rows.length > 0) {
        yield `${n > 0 ? "," : ""}${rows.map((r) => JSON.stringify(r)).join(",")}`;
        n += rows.length;
      }
      if (rows.length < BACKUP_PAGE) break;
    }
    counts[name] = n;
    yield "]";
  }
  yield `},"counts":${JSON.stringify(counts)}}`;
}

export type BackupCheck = { ok: true; counts: Record<string, number> } | { ok: false; error: string };

/** Used by the restore script (a copy of this logic lives in scripts/restore-backup.mjs). */
export function checkBackup(data: unknown): BackupCheck {
  if (typeof data !== "object" || data === null) return { ok: false, error: "ไฟล์ไม่ใช่ JSON ของข้อมูลสำรอง" };
  const d = data as { format?: unknown; version?: unknown; tables?: unknown; counts?: unknown };
  if (d.format !== BACKUP_FORMAT) return { ok: false, error: "ไม่ใช่ไฟล์สำรองข้อมูลของระบบนี้" };
  if (d.version !== BACKUP_VERSION) return { ok: false, error: `เวอร์ชันไฟล์สำรอง ${String(d.version)} ไม่รองรับ` };
  if (typeof d.tables !== "object" || d.tables === null) return { ok: false, error: "ไม่พบข้อมูลตารางในไฟล์" };
  const tables = d.tables as Record<string, unknown>;
  const counts: Record<string, number> = {};
  for (const { name } of BACKUP_TABLES) {
    const rows = tables[name];
    if (!Array.isArray(rows)) return { ok: false, error: `ไม่พบตาราง ${name} ในไฟล์` };
    counts[name] = rows.length;
  }
  if (typeof d.counts === "object" && d.counts !== null) {
    const declared = d.counts as Record<string, unknown>;
    for (const { name } of BACKUP_TABLES) {
      if (declared[name] !== counts[name]) return { ok: false, error: `จำนวนแถวของ ${name} ไม่ตรงกับที่บันทึกไว้ (ไฟล์อาจเสียหาย)` };
    }
  } else {
    return { ok: false, error: "ไฟล์ไม่มีส่วนสรุปจำนวนแถว (ไฟล์อาจถูกตัดไม่ครบ)" };
  }
  return { ok: true, counts };
}
