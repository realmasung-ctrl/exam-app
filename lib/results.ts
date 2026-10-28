import "server-only";
import { serviceClient } from "@/lib/supabase/admin";
import { buildReview, type ReviewItem, type ReviewQuestion } from "@/lib/exam-logic";
import type { AttemptStatus, ResultRow } from "@/lib/results-logic";

export type SessionInfo = {
  id: string; title: string; status: string; snapshot_set_title: string | null;
  question_count: number | null; max_points: number | null; pass_percent: number | null;
  expected_participants: number | null; entry_closed_at: string | null; duration_minutes: number;
  reveal_mode: string; opened_at: string | null; ended_at: string | null;
};

const SESSION_COLS =
  "id, title, status, snapshot_set_title, question_count, max_points, pass_percent, expected_participants, entry_closed_at, duration_minutes, reveal_mode, opened_at, ended_at";

type PartRow = {
  id: string; first_name: string; last_name: string; student_code: string | null; status: AttemptStatus;
  started_at: string; submitted_at: string | null; voided_at: string | null;
};
type ResultDb = {
  participant_id: string; score: number; max_score: number; percent: number; correct_count: number;
  wrong_count: number; unanswered_count: number; duration_seconds: number; passed: boolean | null;
};

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export type SessionResults = {
  session: SessionInfo;
  rows: ResultRow[];
  voidedCount: number;
  /** Set when a database query failed, so the page can SAY so instead of silently showing an empty table. */
  error: string | null;
};

/** Everything the results table and the exports need. Unfinished attempts get null scores on purpose.
 *  Results are read with plain queries (no embedded joins) and joined here, so one failing relationship
 *  can never make the whole table look empty. */
export async function loadSessionResults(sessionId: string): Promise<SessionResults | null> {
  const db = serviceClient();
  await db.rpc("finalize_expired"); // grade anyone whose time ran out so the table is current

  const [sRes, pRes] = await Promise.all([
    db.from("exam_sessions").select(SESSION_COLS).eq("id", sessionId).maybeSingle(),
    db.from("exam_participants")
      .select("id, first_name, last_name, student_code, status, started_at, submitted_at, voided_at")
      .eq("session_id", sessionId).order("started_at"),
  ]);
  if (!sRes.data) return null;

  let error: string | null = pRes.error ? `โหลดรายชื่อผู้เข้าสอบไม่สำเร็จ (${pRes.error.message})` : null;
  const parts = (pRes.data ?? []) as PartRow[];
  const active = parts.filter((p) => p.voided_at === null);

  const finishedIds = active.filter((p) => p.status !== "in_progress").map((p) => p.id);
  const results = new Map<string, ResultDb>();
  const resRes = await Promise.all(
    chunk(finishedIds, 100).map((ids) =>
      db.from("exam_results")
        .select("participant_id, score, max_score, percent, correct_count, wrong_count, unanswered_count, duration_seconds, passed")
        .in("participant_id", ids),
    ),
  );
  for (const r of resRes) {
    if (r.error) error = `โหลดคะแนนไม่สำเร็จ (${r.error.message})`;
    for (const x of (r.data ?? []) as ResultDb[]) results.set(x.participant_id, x);
  }

  const rows: ResultRow[] = active.map((p, i) => {
    const res = p.status === "in_progress" ? null : (results.get(p.id) ?? null);
    return {
      no: i + 1,
      participantId: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      studentCode: p.student_code,
      status: p.status,
      startedAt: p.started_at,
      submittedAt: p.submitted_at,
      score: res ? Number(res.score) : null,
      maxScore: res ? Number(res.max_score) : null,
      percent: res ? Number(res.percent) : null,
      correct: res ? res.correct_count : null,
      wrong: res ? res.wrong_count : null,
      unanswered: res ? res.unanswered_count : null,
      durationSeconds: res ? res.duration_seconds : null,
      passed: res ? res.passed : null,
    };
  });
  return { session: sRes.data as SessionInfo, rows, voidedCount: parts.length - active.length, error };
}

export type DetailItem = ReviewItem & { points: number; earned: number };

export type ParticipantDetail = {
  session: SessionInfo;
  row: ResultRow;
  answeredCount: number; // shown while the attempt is still in progress
  items: DetailItem[] | null; // null while in progress: no grading shown before submission
  error: string | null;
};

type QRow = {
  id: string; position: number; body: string; explanation: string | null; points: number;
  session_choices: { label: string; body: string; is_correct: boolean }[];
};

export async function loadParticipantDetail(sessionId: string, participantId: string): Promise<ParticipantDetail | null> {
  const all = await loadSessionResults(sessionId);
  if (!all) return null;
  const row = all.rows.find((r) => r.participantId === participantId);
  if (!row) return null; // also hides voided attempts and participants of other sessions

  const db = serviceClient();
  const [aRes, qRes] = await Promise.all([
    db.from("participant_answers").select("session_question_id, choice_label").eq("participant_id", participantId),
    db.from("session_questions")
      .select("id, position, body, explanation, points, session_choices(label, body, is_correct)")
      .eq("session_id", sessionId).order("position"),
  ]);
  const error = aRes.error ? `โหลดคำตอบไม่สำเร็จ (${aRes.error.message})`
    : qRes.error ? `โหลดข้อสอบไม่สำเร็จ (${qRes.error.message})` : all.error;

  const answers: Record<string, string> = {};
  for (const r of (aRes.data ?? []) as { session_question_id: string; choice_label: string }[]) {
    answers[r.session_question_id] = r.choice_label;
  }
  const answeredCount = Object.keys(answers).length;
  if (row.status === "in_progress") return { session: all.session, row, answeredCount, items: null, error };

  const qs = (qRes.data ?? []) as QRow[];
  const review = buildReview(
    qs.map((x): ReviewQuestion => ({
      id: x.id, position: x.position, body: x.body, explanation: x.explanation, choices: x.session_choices,
    })),
    answers,
  );
  const pointsByPos = new Map(qs.map((x) => [x.position, Number(x.points)]));
  const items: DetailItem[] = review.map((it) => {
    const points = pointsByPos.get(it.position) ?? 0;
    return { ...it, points, earned: it.status === "correct" ? points : 0 };
  });
  return { session: all.session, row, answeredCount, items, error };
}
