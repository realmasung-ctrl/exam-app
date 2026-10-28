import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/admin";
import { NO_STORE, sameOrigin, tokenHash } from "@/lib/exam";
import { isUuid, parseLabel } from "@/lib/validation";

export const dynamic = "force-dynamic";

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// Saves (or clears) ONE answer. All checks that matter (token, deadline, session, question
// ownership, stale retry) are enforced inside the database function save_answer().
export async function PUT(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!sameOrigin(req)) return json({ code: "FORBIDDEN" }, 403);
  const { code } = await params;
  const hash = await tokenHash(code);
  if (!hash) return json({ code: "INVALID_TOKEN" }, 401);

  let body: { question_id?: unknown; label?: unknown; seq?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ code: "BAD_REQUEST" }, 400);
  }

  const label = body.label === null ? null : parseLabel(body.label);
  const seq = body.seq;
  if (!isUuid(body.question_id) || (body.label !== null && label === null) ||
      typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) {
    return json({ code: "BAD_REQUEST" }, 400);
  }

  const { data, error } = await serviceClient().rpc("save_answer", {
    p_token_hash: hash,
    p_session_question_id: body.question_id,
    p_choice_label: label,
    p_client_seq: seq,
  });
  if (error) {
    const c = error.message;
    if (c === "INVALID_TOKEN") return json({ code: c }, 401);
    if (c === "EXPIRED" || c === "ALREADY_SUBMITTED") return json({ code: c }, 409);
    if (c === "INVALID_QUESTION" || c === "INVALID_CHOICE") return json({ code: c }, 400);
    return json({ code: "SERVER" }, 500);
  }
  return json({ ok: true, ...(data as Record<string, unknown>) });
}
