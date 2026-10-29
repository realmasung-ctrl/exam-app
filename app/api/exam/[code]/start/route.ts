import { NextResponse } from "next/server";
import { NO_STORE, cookieName, examCookieOptions, sameOrigin } from "@/lib/exam";
import { startAttemptFor } from "@/lib/exam-start";

export const dynamic = "force-dynamic";

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

const STATUS: Record<string, number> = {
  NAME_REQUIRED: 400, CODE_INVALID: 400, STUDENT_CODE_REQUIRED: 400, INVALID_TOKEN: 400,
  SESSION_NOT_FOUND: 404,
  SESSION_CLOSED: 403, ENTRY_CLOSED: 403, SESSION_NOT_YET_OPEN: 403,
  ALREADY_STARTED: 409,
  SESSION_FULL: 429,
};

// Same rules as the join form (both call startAttemptFor). Exists so the whole exam flow can be
// exercised by scripts (scripts/blackbox-test.mjs) without a browser.
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!sameOrigin(req)) return json({ code: "FORBIDDEN" }, 403);
  const { code } = await params;

  let body: { first_name?: unknown; last_name?: unknown; student_code?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ code: "BAD_REQUEST" }, 400);
  }

  const r = await startAttemptFor(code, body.first_name, body.last_name, body.student_code);
  if (!r.ok) return json({ code: r.code }, STATUS[r.code] ?? 500);

  const res = json({ ok: true });
  res.cookies.set(cookieName(code), r.token, examCookieOptions());
  return res;
}
