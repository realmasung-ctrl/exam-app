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

type ResultJoin = {
  score: number; max_score: number; percent: number; correct_count: number; wrong_count: number;
  unanswered_count: number; duration_seconds: number; passed: boolean | null; finalize_reason: string;
};
type PartJoin = {
  id: string; first_name: string; last_name: string; student_code: string | null; status: AttemptStatus;
  started_at: string; submitted_at: string | null; voided_at: string | null;
  exam_results: ResultJoin | ResultJoin[] | null;
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Everything the results table and the exports need. Unfinished attempts get null scores on purpose. */
export async function loadSessionResults(
  sessionId: string,
): Promise<{ session: SessionInfo; rows: ResultRow[]; voidedCount: number } | null> {
  const db = serviceClient();
  await db.rpc("finalize_expired"); // grade anyone whose time ran out so the table is current

  const { data: s } = await db.from("exam_sessions").select(SESSION_COLS).eq("id", sessionId).maybeSingle();
  if (!s) return null;

  const { data } = await db.from("exam_participants")
    .select("id, first_name, last_name, student_code, status, started_at, submitted_at, voided_at, exam_results(score, max_score, percent, correct_count, wrong_count, unanswered_count, duration_seconds, passed, finalize_reason)")
    .eq("session_id", sessionId).order("started_at");
  const parts = (data ?? []) as unknown as PartJoin[];

  const active = parts.filter((p) => p.voided_at === null);
  const rows: ResultRow[] = active.map((p, i) => {
    const res = p.status === "in_progress" ? null : one(p.exam_results);
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
  return { session: s as SessionInfo, rows, voidedCount: parts.length - active.length };
}

export type DetailItem = ReviewItem & { points: number; earned: number };

export type ParticipantDetail = {
  session: SessionInfo;
  row: ResultRow;
  answeredCount: number; // shown while the attempt is still in progress
  items: DetailItem[] | null; // null while in progress: no grading shown before submission
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
  const { data: a } = await db.from("participant_answers")
    .select("session_question_id, choice_label").eq("participant_id", participantId);
  const answers: Record<string, string> = {};
  for (const r of (a ?? []) as { session_question_id: string; choice_label: string }[]) {
    answers[r.session_question_id] = r.choice_label;
  }
  const answeredCount = Object.keys(answers).length;
  if (row.status === "in_progress") return { session: all.session, row, answeredCount, items: null };

  const { data: q } = await db.from("session_questions")
    .select("id, position, body, explanation, points, session_choices(label, body, is_correct)")
    .eq("session_id", sessionId).order("position");
  const qs = (q ?? []) as QRow[];
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
  return { session: all.session, row, answeredCount, items };
}
