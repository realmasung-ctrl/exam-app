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
