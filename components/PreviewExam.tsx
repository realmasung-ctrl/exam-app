"use client";
import { useState } from "react";

type PQ = { id: string; body: string; points: number; choices: { label: string; body: string }[] };

export default function PreviewExam({
  title, instructions, questions,
}: { title: string; instructions: string; questions: PQ[] }) {
  const [i, setI] = useState(-1); // -1 = intro screen
  const [done, setDone] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const total = questions.reduce((s, q) => s + q.points, 0);
  const answered = questions.filter((q) => answers[q.id]).length;

  if (questions.length === 0) return <div className="panel pv">ชุดนี้ยังไม่มีคำถาม</div>;

  if (i === -1) {
    return (
      <div className="panel pv">
        <h1>{title}</h1>
        {instructions && <p style={{ whiteSpace: "pre-wrap" }}>{instructions}</p>}
        <p className="muted">{questions.length} ข้อ · คะแนนเต็ม {total}</p>
        <button className="btn primary" onClick={() => setI(0)}>เริ่มดูตัวอย่าง</button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="panel pv">
        <h2>จบตัวอย่าง</h2>
        <p>ในการสอบจริง ผู้เรียนจะเห็นหน้าต่างยืนยันก่อนส่ง และระบบจะตรวจคะแนนที่เซิร์ฟเวอร์</p>
        <button className="btn" onClick={() => { setDone(false); setI(-1); setAnswers({}); }}>เริ่มดูใหม่</button>
      </div>
    );
  }

  const q = questions[i];
  return (
    <div className="pv">
      <div className="pv-top">
        <span>{title}</span>
        <span>ตอบแล้ว {answered}/{questions.length}</span>
      </div>
      <div className="bar" aria-hidden><i style={{ width: `${(answered / questions.length) * 100}%` }} /></div>

      <div className="panel">
        <p className="muted small">ข้อ {i + 1} / {questions.length} · {q.points} คะแนน</p>
        <p style={{ fontSize: "1.15rem", whiteSpace: "pre-wrap" }}>{q.body || "(ยังไม่ได้กรอกคำถาม)"}</p>
        {q.choices.map((c) => (
          <button key={c.label} type="button" className="opt" aria-pressed={answers[q.id] === c.label}
            onClick={() => setAnswers((a) => ({ ...a, [q.id]: c.label }))}>
            <b>{c.label}</b><span>{c.body || "(ว่าง)"}</span>
          </button>
        ))}
      </div>

      <div className="actions" style={{ justifyContent: "space-between" }}>
        <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>← ก่อนหน้า</button>
        <button className="btn" disabled={i === questions.length - 1} onClick={() => setI(i + 1)}>ถัดไป →</button>
      </div>

      <div className="grid" role="group" aria-label="เลือกข้อ">
        {questions.map((x, n) => (
          <button key={x.id} type="button" className={`${answers[x.id] ? "done" : ""} ${n === i ? "cur" : ""}`}
            aria-label={`ไปข้อ ${n + 1}`} onClick={() => setI(n)}>{n + 1}</button>
        ))}
      </div>
      <button className="btn primary" onClick={() => setDone(true)}>ส่งข้อสอบ (ตัวอย่าง)</button>
    </div>
  );
}
