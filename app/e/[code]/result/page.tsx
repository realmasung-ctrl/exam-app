import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/supabase/admin";
import { loadAttempt } from "@/lib/exam";
import { formatDuration } from "@/lib/exam-logic";

export const dynamic = "force-dynamic";

type ResultRow = {
  score: number; max_score: number; percent: number; correct_count: number; wrong_count: number;
  unanswered_count: number; duration_seconds: number; passed: boolean | null; finalize_reason: string;
};

const REASON: Record<string, string> = {
  submitted: "ส่งข้อสอบด้วยตนเอง",
  timed_out: "หมดเวลา ระบบส่งคำตอบให้อัตโนมัติ",
  closed_by_admin: "ผู้ดูแลปิดรอบสอบ ระบบส่งคำตอบให้อัตโนมัติ",
};

// Shows ONLY the result of the attempt that belongs to this browser's token.
export default async function ResultPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const ctx = await loadAttempt(code);
  if (!ctx) redirect(`/e/${code}`);
  if (ctx.participant.status === "in_progress") redirect(`/e/${code}/take`);

  const { data } = await serviceClient().from("exam_results").select("*")
    .eq("participant_id", ctx.participant.id).maybeSingle();
  const r = (data as ResultRow | null) ?? null;
  const { participant: p, session: s } = ctx;

  return (
    <main className="login">
      <div className="panel" style={{ width: "min(560px, 100%)" }}>
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
    </main>
  );
}
