import "server-only";
import { serviceClient } from "@/lib/supabase/admin";
import { newExamToken, hashToken } from "@/lib/token";
import { CODE_RE } from "@/lib/exam";
import { parseText } from "@/lib/validation";

export type StartResult = { ok: true; token: string } | { ok: false; code: string };

/** Shared by the join form (server action) and POST /api/exam/<code>/start so both obey the same rules.
 *  The token is created here; only its hash reaches the database. */
export async function startAttemptFor(
  code: string, firstRaw: unknown, lastRaw: unknown, studentRaw: unknown,
): Promise<StartResult> {
  if (!CODE_RE.test(code)) return { ok: false, code: "SESSION_NOT_FOUND" };

  const first = parseText(firstRaw, 100, "ชื่อ", true);
  const last = parseText(lastRaw, 100, "นามสกุล", true);
  if (!first.ok || !last.ok) return { ok: false, code: "NAME_REQUIRED" };
  const sc = parseText(studentRaw, 50, "รหัสประจำตัว");
  if (!sc.ok) return { ok: false, code: "CODE_INVALID" };

  const token = newExamToken();
  const { error } = await serviceClient().rpc("start_attempt", {
    p_code: code,
    p_first_name: first.value,
    p_last_name: last.value,
    p_student_code: sc.value === "" ? null : sc.value,
    p_token_hash: hashToken(token),
  });
  if (error) return { ok: false, code: error.message };
  return { ok: true, token };
}
