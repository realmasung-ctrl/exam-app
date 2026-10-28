// Pure helpers for the student exam screen (no imports, so they can be unit-tested with node --test).

export type TimerLevel = "normal" | "warn" | "danger";

/** 125000 ms -> "02:05". Rounds up so the clock never shows 00:00 while time is still left. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function timerLevel(ms: number): TimerLevel {
  if (ms <= 60_000) return "danger";
  if (ms <= 300_000) return "warn";
  return "normal";
}

/** Time left according to the server's clock: deadline - server_now, minus half the round trip. */
export function remainingFrom(deadlineIso: string, serverNowIso: string, rttMs: number): number {
  const d = Date.parse(deadlineIso);
  const n = Date.parse(serverNowIso);
  if (Number.isNaN(d) || Number.isNaN(n)) return 0;
  return Math.max(0, d - n - Math.max(0, rttMs) / 2);
}

/** Sequence numbers make the server ignore stale retries. They must keep growing even after a
 *  page refresh (counter restarts) or a client clock that moved backwards, so take the maximum of all. */
export function nextSeq(current: number, serverMax: number, now: number): number {
  return Math.max(current + 1, serverMax + 1, now);
}

/** Server answers are the truth, except answers the student changed that are not saved yet. */
export function mergeAnswers(
  server: Record<string, string>,
  unsaved: Map<string, { label: string | null }>,
): Record<string, string> {
  const out: Record<string, string> = { ...server };
  unsaved.forEach((v, qid) => {
    if (v.label === null) delete out[qid];
    else out[qid] = v.label;
  });
  return out;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} วินาที`;
  return `${m} นาที ${r} วินาที`;
}

// ---------------------------------------------------------------------
// Phase 7: when may a student see the answer key, and how is the review built
// ---------------------------------------------------------------------

/** immediate = right after submitting; after_close = only once the admin ended/disabled the session;
 *  hidden (or anything unknown) = never. Evaluated on every page load, so changing the setting takes effect at once. */
export function canReveal(mode: string, sessionStatus: string): boolean {
  if (mode === "immediate") return true;
  if (mode === "after_close") return sessionStatus === "ended" || sessionStatus === "disabled";
  return false;
}

export type ReviewChoice = { label: string; body: string; is_correct: boolean };
export type ReviewQuestion = {
  id: string; position: number; body: string; explanation: string | null; choices: ReviewChoice[];
};
export type ReviewItem = {
  position: number;
  body: string;
  explanation: string | null;
  status: "correct" | "wrong" | "unanswered";
  myLabel: string | null;
  correctLabel: string | null;
  choices: { label: string; body: string; isCorrect: boolean; isMine: boolean }[];
};

const LABEL_ORDER = ["ก", "ข", "ค", "ง"];

export function buildReview(questions: ReviewQuestion[], answers: Record<string, string>): ReviewItem[] {
  return [...questions]
    .sort((a, b) => a.position - b.position)
    .map((q) => {
      const myLabel = answers[q.id] ?? null;
      const choices = [...q.choices].sort((a, b) => LABEL_ORDER.indexOf(a.label) - LABEL_ORDER.indexOf(b.label));
      const correct = choices.find((c) => c.is_correct) ?? null;
      const status: ReviewItem["status"] =
        myLabel === null ? "unanswered" : correct !== null && myLabel === correct.label ? "correct" : "wrong";
      return {
        position: q.position,
        body: q.body,
        explanation: q.explanation && q.explanation.trim() !== "" ? q.explanation : null,
        status,
        myLabel,
        correctLabel: correct ? correct.label : null,
        choices: choices.map((c) => ({
          label: c.label, body: c.body, isCorrect: c.is_correct, isMine: c.label === myLabel,
        })),
      };
    });
}
