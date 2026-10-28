// Pure helpers for the admin results screens and exports (no imports -> unit-testable with node --test).

export type AttemptStatus = "in_progress" | "submitted" | "timed_out" | "closed_by_admin";

export type ResultRow = {
  no: number; // arrival order within the session (stable, independent of filters)
  participantId: string;
  firstName: string;
  lastName: string;
  studentCode: string | null;
  status: AttemptStatus;
  startedAt: string;
  submittedAt: string | null;
  // null until the attempt is finished: an unfinished attempt must never look like a final score
  score: number | null;
  maxScore: number | null;
  percent: number | null;
  correct: number | null;
  wrong: number | null;
  unanswered: number | null;
  durationSeconds: number | null;
  passed: boolean | null;
};

export type SortKey = "started" | "name" | "score" | "percent" | "duration";
export type SortDir = "asc" | "desc";
export type StatusFilter =
  | "all" | "in_progress" | "submitted" | "timed_out" | "closed_by_admin" | "passed" | "failed";

const SORT_KEYS: SortKey[] = ["started", "name", "score", "percent", "duration"];
const FILTERS: StatusFilter[] = ["all", "in_progress", "submitted", "timed_out", "closed_by_admin", "passed", "failed"];

export function parseSortKey(v: unknown): SortKey {
  return typeof v === "string" && (SORT_KEYS as string[]).includes(v) ? (v as SortKey) : "started";
}
export function parseSortDir(v: unknown): SortDir {
  return v === "desc" ? "desc" : "asc";
}
export function parseStatusFilter(v: unknown): StatusFilter {
  return typeof v === "string" && (FILTERS as string[]).includes(v) ? (v as StatusFilter) : "all";
}

export const STATUS_LABEL: Record<AttemptStatus, string> = {
  in_progress: "กำลังสอบ (ยังไม่ส่ง)",
  submitted: "ส่งด้วยตนเอง",
  timed_out: "หมดเวลา",
  closed_by_admin: "ผู้ดูแลปิดรอบสอบ",
};

const norm = (s: string) => s.normalize("NFC").toLowerCase().trim();

export function filterSortRows(
  rows: ResultRow[],
  opts: { q: string; status: StatusFilter; sort: SortKey; dir: SortDir },
): ResultRow[] {
  const q = norm(opts.q);
  let out = rows.filter((r) => {
    if (q !== "") {
      const hay = norm(`${r.firstName} ${r.lastName} ${r.studentCode ?? ""}`);
      if (!hay.includes(q)) return false;
    }
    switch (opts.status) {
      case "all": return true;
      case "passed": return r.passed === true;
      case "failed": return r.passed === false;
      default: return r.status === opts.status;
    }
  });

  const sign = opts.dir === "desc" ? -1 : 1;
  const num = (r: ResultRow): number | null => {
    switch (opts.sort) {
      case "score": return r.score;
      case "percent": return r.percent;
      case "duration": return r.durationSeconds;
      default: return null;
    }
  };

  out = [...out].sort((a, b) => {
    let c = 0;
    if (opts.sort === "name") {
      c = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, "th");
    } else if (opts.sort === "started") {
      c = a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0;
    } else {
      const x = num(a);
      const y = num(b);
      if (x === null && y === null) c = 0;
      else if (x === null) return 1; // unfinished attempts always sink to the bottom, either direction
      else if (y === null) return -1;
      else c = x - y;
    }
    if (c === 0) return a.no - b.no;
    return c * sign;
  });
  return out;
}

export function summarize(rows: ResultRow[], expected: number | null) {
  const entered = rows.length;
  const inProgress = rows.filter((r) => r.status === "in_progress").length;
  const finishedRows = rows.filter((r) => r.status !== "in_progress");
  const pcts = finishedRows.map((r) => r.percent).filter((p): p is number => p !== null);
  const avgPercent = pcts.length === 0 ? null : Math.round((pcts.reduce((s, p) => s + p, 0) / pcts.length) * 100) / 100;
  return {
    entered,
    inProgress,
    finished: finishedRows.length,
    notStarted: expected === null ? null : Math.max(expected - entered, 0),
    avgPercent,
    passedCount: rows.filter((r) => r.passed === true).length,
    failedCount: rows.filter((r) => r.passed === false).length,
  };
}

/** UTC ISO -> "2026-10-28 09:30:15" in Bangkok time (UTC+7, no DST). */
export function formatBangkok(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + 7 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
}

/** 330 -> "05:30" (minutes may exceed 99). */
export function formatMinSec(totalSeconds: number | null): string {
  if (totalSeconds === null) return "";
  const s = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** CSV cell. Text starting with = + - @ (or tab/CR) is prefixed with ' so spreadsheets never run it as a formula. */
export function csvCell(v: string | number | null): string {
  if (v === null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Safe file name part (keeps Thai letters, removes characters illegal in file names). */
export function safeFilename(name: string): string {
  const s = name.replace(/[\\/:*?"<>|%\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return s === "" ? "export" : s;
}

export const EXPORT_HEADERS = [
  "ลำดับ", "ชื่อ", "นามสกุล", "รหัสประจำตัว", "เวลาเริ่มสอบ", "เวลาส่งข้อสอบ", "เวลาที่ใช้ (นาที:วินาที)",
  "คะแนนที่ได้", "คะแนนเต็ม", "เปอร์เซ็นต์", "ตอบถูก", "ตอบผิด", "ไม่ได้ตอบ", "ผลผ่าน/ไม่ผ่าน", "สถานะการส่ง",
];

export function exportRow(r: ResultRow): (string | number | null)[] {
  return [
    r.no, r.firstName, r.lastName, r.studentCode ?? "",
    formatBangkok(r.startedAt), formatBangkok(r.submittedAt), formatMinSec(r.durationSeconds),
    r.score, r.maxScore, r.percent, r.correct, r.wrong, r.unanswered,
    r.passed === null ? "" : r.passed ? "ผ่าน" : "ไม่ผ่าน",
    STATUS_LABEL[r.status],
  ];
}
