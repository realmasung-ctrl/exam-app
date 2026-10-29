import "server-only";
import { cookies } from "next/headers";
import { serviceClient } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/token";

export const CODE_RE = /^[0-9a-f]{16}$/;
export const cookieName = (code: string) => `et_${code}`;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

// Server clock and database clock can differ by a few milliseconds; never auto-submit
// from the web server's clock unless the deadline passed by a clear margin.
const LAZY_FINALIZE_GRACE_MS = 2000;

export type AttemptStatus = "in_progress" | "submitted" | "timed_out" | "closed_by_admin";

export type Participant = {
  id: string; session_id: string; first_name: string; last_name: string;
  status: AttemptStatus; started_at: string; deadline_at: string; submitted_at: string | null;
};

export type PublicSession = {
  id: string; public_code: string; title: string;
  snapshot_set_title: string | null; snapshot_instructions: string | null;
  duration_minutes: number; question_count: number | null; max_points: number | null;
  pass_percent: number | null; reveal_mode: "immediate" | "after_close" | "hidden";
  status: string; entry_closed_at: string | null; opens_at: string | null; closes_at: string | null;
  require_student_code: boolean;
};

// NOTE: never add correct-answer columns here: this shape is what students may receive.
export const SESSION_COLS =
  "id, public_code, title, snapshot_set_title, snapshot_instructions, duration_minutes, question_count, max_points, pass_percent, reveal_mode, status, entry_closed_at, opens_at, closes_at, require_student_code";
const PARTICIPANT_COLS = "id, session_id, first_name, last_name, status, started_at, deadline_at, submitted_at";

export async function readToken(code: string): Promise<string | null> {
  if (!CODE_RE.test(code)) return null;
  const v = (await cookies()).get(cookieName(code))?.value;
  return v && TOKEN_RE.test(v) ? v : null;
}

export async function tokenHash(code: string): Promise<string | null> {
  const t = await readToken(code);
  return t ? hashToken(t) : null;
}

/** The attempt that belongs to THIS browser's token for THIS session code (or null). */
export async function loadAttempt(code: string): Promise<{ participant: Participant; session: PublicSession } | null> {
  const hash = await tokenHash(code);
  if (!hash) return null;

  const db = serviceClient();
  const { data: p } = await db.from("exam_participants").select(PARTICIPANT_COLS)
    .eq("token_hash", hash).is("voided_at", null).maybeSingle();
  if (!p) return null;

  const { data: s } = await db.from("exam_sessions").select(SESSION_COLS).eq("id", p.session_id).maybeSingle();
  if (!s || s.public_code !== code) return null; // token from another session

  let participant = p as Participant;
  if (participant.status === "in_progress" &&
      Date.now() >= Date.parse(participant.deadline_at) + LAZY_FINALIZE_GRACE_MS) {
    await db.rpc("submit_attempt", { p_token_hash: hash }); // DB decides: timed_out
    const { data: p2 } = await db.from("exam_participants").select(PARTICIPANT_COLS).eq("id", p.id).maybeSingle();
    if (p2) participant = p2 as Participant;
  }
  return { participant, session: s as PublicSession };
}

/** Light CSRF defence for the JSON endpoints (cookies are also SameSite=Lax). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** One place that decides how the exam token cookie is protected. */
export function examCookieOptions() {
  return {
    httpOnly: true, // JavaScript on the page can never read the token
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24,
  };
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;
