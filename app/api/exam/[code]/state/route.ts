import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/admin";
import { NO_STORE, loadAttempt } from "@/lib/exam";

export const dynamic = "force-dynamic";

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// Lets the exam screen re-sync time left + saved answers after a refresh, a sleeping tab or a network drop.
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ctx = await loadAttempt(code);
  if (!ctx) return json({ code: "INVALID_TOKEN" }, 401);

  const { participant } = ctx;
  if (participant.status !== "in_progress") {
    return json({ status: participant.status });
  }

  const { data } = await serviceClient().from("participant_answers")
    .select("session_question_id, choice_label, client_seq").eq("participant_id", participant.id);
  const rows = (data ?? []) as { session_question_id: string; choice_label: string; client_seq: number }[];

  const answers: Record<string, string> = {};
  let maxSeq = 0;
  for (const r of rows) {
    answers[r.session_question_id] = r.choice_label;
    maxSeq = Math.max(maxSeq, Number(r.client_seq));
  }
  return json({
    status: participant.status,
    deadline_at: participant.deadline_at,
    server_now: new Date().toISOString(),
    answers,
    max_seq: maxSeq,
  });
}
