import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/supabase/admin";
import { loadAttempt } from "@/lib/exam";
import { LABELS } from "@/lib/validation";
import ExamTaker from "@/components/ExamTaker";

export const dynamic = "force-dynamic";

type QRow = { id: string; position: number; body: string; session_choices: { label: string; body: string }[] };

export default async function TakePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const ctx = await loadAttempt(code);
  if (!ctx) redirect(`/e/${code}`);
  if (ctx.participant.status !== "in_progress") redirect(`/e/${code}/result`);

  const db = serviceClient();
  const [qRes, aRes] = await Promise.all([
    // is_correct is deliberately NOT selected: students never receive the answer key
    db.from("session_questions").select("id, position, body, session_choices(label, body)")
      .eq("session_id", ctx.session.id).order("position"),
    db.from("participant_answers").select("session_question_id, choice_label, client_seq")
      .eq("participant_id", ctx.participant.id),
  ]);

  const questions = ((qRes.data ?? []) as QRow[]).map((q) => ({
    id: q.id,
    position: q.position,
    body: q.body,
    choices: LABELS.map((l) => ({ label: l as string, body: q.session_choices.find((c) => c.label === l)?.body ?? "" })),
  }));

  const initialAnswers: Record<string, string> = {};
  let initialSeq = 0;
  for (const r of (aRes.data ?? []) as { session_question_id: string; choice_label: string; client_seq: number }[]) {
    initialAnswers[r.session_question_id] = r.choice_label;
    initialSeq = Math.max(initialSeq, Number(r.client_seq));
  }

  const remainingMs = Math.max(0, Date.parse(ctx.participant.deadline_at) - Date.now());

  return (
    <ExamTaker
      code={code}
      title={ctx.session.snapshot_set_title ?? ctx.session.title}
      studentName={`${ctx.participant.first_name} ${ctx.participant.last_name}`}
      questions={questions}
      initialAnswers={initialAnswers}
      initialSeq={initialSeq}
      remainingMs={remainingMs}
    />
  );
}
