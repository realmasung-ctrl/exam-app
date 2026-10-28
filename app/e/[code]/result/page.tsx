import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/supabase/admin";
import { loadAttempt } from "@/lib/exam";
import { buildReview, canReveal, formatDuration, type ReviewItem, type ReviewQuestion } from "@/lib/exam-logic";

export const dynamic = "force-dynamic";

type ResultRow = {
  score: number; max_score: number; percent: number; correct_count: number; wrong_count: number;
  unanswered_count: number; duration_seconds: number; passed: boolean | null; finalize_reason: string;
};
type QRow = {
  id: string; position: number; body: string; explanation: string | null;
  session_choices: { label: string; body: string; is_correct: boolean }[];
};

const REASON: Record<string, string> = {
  submitted: "ส่งข้อสอบด้วยตนเอง",
  timed_out: "หมดเวลา ระบบส่งคำตอบให้อัตโนมัติ",
  closed_by_admin: "ผู้ดูแลปิดรอบสอบ ระบบส่งคำตอบให้อัตโนมัติ",
};
const STATUS_TEXT: Record<ReviewItem["status"], string> = {
  correct: "ตอบถูก",
  wrong: "ตอบผิด",
  unanswered: "ไม่ได้ตอบ",
};

// Shows ONLY the result of the attempt that belongs to this browser's token.
export default async function ResultPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const ctx = await loadAttempt(code);
  if (!ctx) redirect(`/e/${code}`);
  if (ctx.participant.status === "in_progress") redirect(`/e/${code}/take`);

  const { participant: p, session: s } = ctx;
  const db = serviceClient();

  const { data } = await db.from("exam_results").select("*").eq("participant_id", p.id).maybeSingle();
  const r = (data as ResultRow | null) ?? null;

  // The answer key is only read from the database when the admin's setting allows it right now.
  const revealAllowed = canReveal(s.reveal_mode, s.status);
  let review: ReviewItem[] = [];
  if (revealAllowed) {
    const [qRes, aRes] = await Promise.all([
      db.from("session_questions")
        .select("id, position, body, explanation, session_choices(label, body, is_correct)")
        .eq("session_id", s.id).order("position"),
      db.from("participant_answers").select("session_question_id, choice_label").eq("participant_id", p.id),
    ]);
    const questions: ReviewQuestion[] = ((qRes.data ?? []) as QRow[]).map((q) => ({
      id: q.id, position: q.position, body: q.body, explanation: q.explanation, choices: q.session_choices,
    }));
    const answers: Record<string, string> = {};
    for (const a of (aRes.data ?? []) as { session_question_id: string; choice_label: string }[]) {
      answers[a.session_question_id] = a.choice_label;
    }
    review = buildReview(questions, answers);
  }

  return (
    <main className="result-wrap">
      <div className="panel">
        <h1>ส่งข้อสอบเรียบร้อยแล้ว</h1>
        <p className="muted">{p.first_name} {p.last_name} · {s.snapshot_set_title ?? s.title}</p>

        {!r ? (
          <div className="flash ok" role="status">กำลังประมวลผลคะแนน กรุณารีเฟรชหน้านี้อีกครั้ง</div>
        ) : (
          <>
            <div className="score">
              <b>{Number(r.score)}</b><span>/ {Number(r.max_score)} คะแนน ({Number(r.percent)}%)</span>
            </div>
            {r.passed !== null && (
              <div className={`flash ${r.passed ? "ok" : "err"}`} role="status">{r.passed ? "ผ่านเกณฑ์" : "ไม่ผ่านเกณฑ์"}</div>
            )}
            <section className="stats" aria-label="สรุปผล">
              <div><b>{r.correct_count}</b><span>ตอบถูก</span></div>
              <div><b>{r.wrong_count}</b><span>ตอบผิด</span></div>
              <div><b>{r.unanswered_count}</b><span>ไม่ได้ตอบ</span></div>
            </section>
            <p className="muted small">เวลาที่ใช้ {formatDuration(r.duration_seconds)} · {REASON[r.finalize_reason] ?? ""}</p>
          </>
        )}
      </div>

      {revealAllowed ? (
        <section aria-label="เฉลยรายข้อ">
          <h2>เฉลยรายข้อ</h2>
          {review.map((item) => (
            <article key={item.position} className={`rv ${item.status}`}>
              <div className="rv-head">
                <strong>ข้อ {item.position}</strong>
                <span className={`badge ${item.status === "correct" ? "ok" : item.status === "wrong" ? "bad" : ""}`}>
                  {STATUS_TEXT[item.status]}
                </span>
              </div>
              <p className="rv-q">{item.body}</p>
              <ul className="rv-opts">
                {item.choices.map((c) => (
                  <li key={c.label} className={`${c.isCorrect ? "is-correct" : ""} ${c.isMine && !c.isCorrect ? "is-wrong" : ""}`}>
                    <b>{c.label}</b>
                    <span>{c.body}</span>
                    {c.isCorrect && <em>เฉลย</em>}
                    {c.isMine && <em>คำตอบของคุณ</em>}
                  </li>
                ))}
              </ul>
              {item.status === "unanswered" && <p className="small muted">คุณไม่ได้ตอบข้อนี้ เฉลยคือข้อ {item.correctLabel}</p>}
              {item.explanation && <p className="rv-exp"><strong>คำอธิบาย:</strong> {item.explanation}</p>}
            </article>
          ))}
        </section>
      ) : (
        <div className="panel">
          <p style={{ margin: 0 }}>
            {s.reveal_mode === "after_close"
              ? "เฉลยรายข้อจะแสดงเมื่อสิ้นสุดรอบสอบ กรุณาเปิดลิงก์เดิมอีกครั้งหลังจากนั้น"
              : "ผู้ดูแลยังไม่เปิดให้ดูเฉลย"}
          </p>
        </div>
      )}
    </main>
  );
}
