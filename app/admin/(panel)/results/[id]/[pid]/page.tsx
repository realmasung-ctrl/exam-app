import { notFound } from "next/navigation";
import { isUuid } from "@/lib/validation";
import { loadParticipantDetail } from "@/lib/results";
import { allowRetake } from "@/lib/actions/results";
import { STATUS_LABEL, formatBangkok, formatMinSec } from "@/lib/results-logic";
import ConfirmButton from "@/components/ConfirmButton";
import AutoRefresh from "@/components/AutoRefresh";
import Flash from "@/components/Flash";
import BackLink from "@/components/BackLink";

const ITEM_TEXT = { correct: "ตอบถูก", wrong: "ตอบผิด", unanswered: "ไม่ได้ตอบ" } as const;

export default async function ParticipantPage({ params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  if (!isUuid(id) || !isUuid(pid)) notFound();

  const d = await loadParticipantDetail(id, pid);
  if (!d) notFound();
  const { session: s, row: r, items } = d;
  const canRetake = s.status === "open" || s.status === "running";

  return (
    <>
      {r.status === "in_progress" && <AutoRefresh intervalMs={5000} />}
      <div className="page-head">
        <div>
          <BackLink href={`/admin/results/${id}`}>ผลสอบ {s.title}</BackLink>
          <h1>{r.firstName} {r.lastName}</h1>
          <p className="muted">
            {r.studentCode ? `รหัส ${r.studentCode} · ` : ""}
            เริ่ม {formatBangkok(r.startedAt)}
            {r.submittedAt ? ` · ส่ง ${formatBangkok(r.submittedAt)}` : ""} ·{" "}
            <span className={`badge ${r.status === "in_progress" ? "warn" : ""}`}>{STATUS_LABEL[r.status]}</span>
          </p>
        </div>
        {canRetake && (
          <form className="no-print">
            <ConfirmButton
              action={allowRetake.bind(null, id, pid)}
              message={`อนุญาตให้ ${r.firstName} ${r.lastName} สอบใหม่?\n\nผลสอบเดิมจะถูกเก็บไว้แต่ไม่แสดงในรายงาน ผู้เรียนจะได้เวลาเต็มอีกครั้ง`}
              className="btn"
            >
              อนุญาตสอบใหม่
            </ConfirmButton>
          </form>
        )}
      </div>

      <Flash err={d.error ?? undefined} />

      {items === null ? (
        <section className="panel">
          <h2>ยังทำข้อสอบอยู่</h2>
          <p>ตอบแล้ว {d.answeredCount} จาก {s.question_count ?? 0} ข้อ — ยังไม่แสดงคะแนนและการตรวจจนกว่าผู้เรียนจะส่งข้อสอบหรือหมดเวลา</p>
        </section>
      ) : (
        <>
          <section className="stats" aria-label="สรุปผลของผู้เรียน">
            <div><b>{r.score} / {r.maxScore}</b><span>คะแนน ({r.percent}%)</span></div>
            <div><b>{r.correct}</b><span>ตอบถูก</span></div>
            <div><b>{r.wrong}</b><span>ตอบผิด</span></div>
            <div><b>{r.unanswered}</b><span>ไม่ได้ตอบ</span></div>
            <div><b>{formatMinSec(r.durationSeconds)}</b><span>เวลาที่ใช้ (นาที:วินาที)</span></div>
            {r.passed !== null && <div><b>{r.passed ? "ผ่าน" : "ไม่ผ่าน"}</b><span>ผลเทียบเกณฑ์</span></div>}
          </section>

          {items.map((it) => (
            <article key={it.position} className={`rv ${it.status}`}>
              <div className="rv-head">
                <strong>ข้อ {it.position}</strong>
                <span>
                  <span className="muted small">{it.earned} / {it.points} คะแนน </span>
                  <span className={`badge ${it.status === "correct" ? "ok" : it.status === "wrong" ? "bad" : ""}`}>{ITEM_TEXT[it.status]}</span>
                </span>
              </div>
              <p className="rv-q">{it.body}</p>
              <ul className="rv-opts">
                {it.choices.map((c) => (
                  <li key={c.label} className={`${c.isCorrect ? "is-correct" : ""} ${c.isMine && !c.isCorrect ? "is-wrong" : ""}`}>
                    <b>{c.label}</b><span>{c.body}</span>
                    {c.isCorrect && <em>เฉลย</em>}
                    {c.isMine && <em>ผู้เรียนเลือก</em>}
                  </li>
                ))}
              </ul>
              {it.status === "unanswered" && <p className="small muted">ผู้เรียนไม่ได้ตอบข้อนี้ เฉลยคือข้อ {it.correctLabel}</p>}
              {it.explanation && <p className="rv-exp"><strong>คำอธิบาย:</strong> {it.explanation}</p>}
            </article>
          ))}
        </>
      )}
    </>
  );
}
