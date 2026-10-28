import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/supabase/admin";
import { isUuid, LABELS } from "@/lib/validation";
import {
  updateSet, deleteSet, addQuestion, saveQuestion, deleteQuestion, moveQuestion, markReady,
} from "@/lib/actions/sets";
import type { Choice, Problem, Question, QuestionSet } from "@/lib/types";
import ConfirmButton from "@/components/ConfirmButton";
import Flash from "@/components/Flash";

export default async function SetPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { id } = await params;
  const { ok, err } = await searchParams;
  if (!isUuid(id)) notFound();

  const db = serviceClient();
  const [setRes, qRes, probRes, sessRes] = await Promise.all([
    db.from("question_sets").select("*").eq("id", id).maybeSingle(),
    db.from("questions").select("*, answer_choices(*)").eq("set_id", id).order("position"),
    db.rpc("validate_question_set", { p_set_id: id }),
    db.from("exam_sessions").select("id", { count: "exact", head: true }).eq("set_id", id),
  ]);
  const set = setRes.data as QuestionSet | null;
  if (!set) notFound();
  const questions = (qRes.data ?? []) as Question[];
  const problems = (probRes.data ?? []) as Problem[];
  const sessionCount = sessRes.count ?? 0;

  const problemsByPos = new Map<number, string[]>();
  for (const p of problems) {
    problemsByPos.set(p.question_position, [...(problemsByPos.get(p.question_position) ?? []), p.problem]);
  }
  const totalPoints =
    set.scoring_mode === "equal"
      ? questions.length * Number(set.equal_points)
      : questions.reduce((s, q) => s + Number(q.points), 0);

  const update = updateSet.bind(null, id);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="small" style={{ margin: 0 }}><Link href="/admin/sets">← ชุดข้อสอบทั้งหมด</Link></p>
          <h1>{set.title}</h1>
          <p className="muted">
            {questions.length} ข้อ · คะแนนเต็ม {totalPoints} ·{" "}
            <span className={`badge ${set.status === "ready" ? "ok" : ""}`}>
              {set.status === "ready" ? "พร้อมใช้งาน" : "ฉบับร่าง"}
            </span>
          </p>
        </div>
        <div className="actions">
          <Link className="btn" href={`/admin/sets/${id}/preview`}>ดูตัวอย่างข้อสอบ</Link>
          <Link className="btn" href={`/admin/sessions?set=${id}`}>สร้างรอบสอบจากชุดนี้</Link>
          <form>
            <ConfirmButton
              action={deleteSet.bind(null, id)}
              message="ลบชุดข้อสอบนี้ใช่หรือไม่? คำถามทั้งหมดในชุดจะถูกลบ (รอบสอบที่เปิดไปแล้วไม่ได้รับผลกระทบ)"
              className="btn danger"
            >
              ลบชุดนี้
            </ConfirmButton>
          </form>
        </div>
      </div>

      <Flash ok={ok} err={err} />

      {sessionCount > 0 && (
        <div className="flash ok" style={{ background: "#e8eefc", color: "#1c3f99" }}>
          ชุดนี้ถูกใช้ใน {sessionCount} รอบสอบ การแก้ไขที่นี่จะไม่กระทบรอบสอบที่เปิดไปแล้ว (ระบบเก็บสำเนาข้อสอบไว้ต่างหาก)
        </div>
      )}

      {problems.length > 0 ? (
        <div className="problems" role="status">
          <strong>ยังเปิดสอบไม่ได้ — มี {problems.length} จุดที่ต้องแก้</strong>
          <ul>
            {problems.map((p, i) => (
              <li key={i}>{p.question_position > 0 ? `ข้อ ${p.question_position}: ` : ""}{p.problem}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="allgood">
          <span>ชุดข้อสอบครบถ้วน พร้อมนำไปเปิดรอบสอบ</span>
          {set.status !== "ready" && (
            <form>
              <ConfirmButton action={markReady.bind(null, id)} message="ทำเครื่องหมายว่าพร้อมใช้งาน?" className="btn">
                ทำเครื่องหมายว่าพร้อมใช้งาน
              </ConfirmButton>
            </form>
          )}
        </div>
      )}

      <form action={update} className="panel">
        <h2>ตั้งค่าชุดข้อสอบ</h2>
        <label className="field">
          <span>ชื่อชุดข้อสอบ</span>
          <input type="text" name="title" defaultValue={set.title} maxLength={200} required />
        </label>
        <label className="field">
          <span>คำชี้แจงก่อนเริ่มสอบ</span>
          <textarea name="instructions" defaultValue={set.instructions} maxLength={5000} />
        </label>
        <div className="row">
          <label className="field">
            <span>วิธีคิดคะแนน</span>
            <select name="scoring_mode" defaultValue={set.scoring_mode}>
              <option value="equal">คะแนนเท่ากันทุกข้อ</option>
              <option value="custom">กำหนดคะแนนแยกแต่ละข้อ</option>
            </select>
          </label>
          <label className="field">
            <span>คะแนนต่อข้อ (ใช้เมื่อเลือกคะแนนเท่ากัน)</span>
            <input type="number" name="equal_points" defaultValue={Number(set.equal_points)} min="0.01" max="1000" step="0.01" />
          </label>
          <label className="field">
            <span>การแสดงเฉลยหลังสอบ (ค่าตั้งต้นของรอบสอบ)</span>
            <select name="default_reveal_mode" defaultValue={set.default_reveal_mode}>
              <option value="immediate">แสดงทันทีหลังส่งข้อสอบ</option>
              <option value="after_close">แสดงหลังสิ้นสุดรอบสอบ</option>
              <option value="hidden">ไม่แสดงเฉลย</option>
            </select>
          </label>
        </div>
        <button className="btn primary" type="submit">บันทึกการตั้งค่า</button>
      </form>

      <h2 style={{ marginTop: "1.5rem" }}>คำถาม</h2>
      {questions.length === 0 && <p className="muted">ยังไม่มีคำถาม กด “เพิ่มคำถาม” ด้านล่างเพื่อเริ่มต้น</p>}

      {questions.map((q, idx) => {
        const probs = problemsByPos.get(idx + 1) ?? [];
        const choices = LABELS.map((l) => (q.answer_choices ?? []).find((c: Choice) => c.label === l));
        const save = saveQuestion.bind(null, id, q.id);
        return (
          <section key={q.id} id={`q-${q.id}`} className={`q ${probs.length ? "has-problem" : "complete"}`}>
            <form action={save}>
              <div className="q-head">
                <span className="q-no">ข้อ {idx + 1}</span>
                <div className="actions">
                  <button className="btn icon" type="submit" formNoValidate disabled={idx === 0}
                    formAction={moveQuestion.bind(null, id, q.id, "up")} aria-label={`เลื่อนข้อ ${idx + 1} ขึ้น`}>↑</button>
                  <button className="btn icon" type="submit" formNoValidate disabled={idx === questions.length - 1}
                    formAction={moveQuestion.bind(null, id, q.id, "down")} aria-label={`เลื่อนข้อ ${idx + 1} ลง`}>↓</button>
                  <ConfirmButton action={deleteQuestion.bind(null, id, q.id)} message={`ลบข้อ ${idx + 1} ใช่หรือไม่?`}
                    className="btn danger" ariaLabel={`ลบข้อ ${idx + 1}`}>ลบ</ConfirmButton>
                </div>
              </div>

              {probs.length > 0 && <p className="small" style={{ color: "#8a5a0c" }}>ต้องแก้: {probs.join(" · ")}</p>}

              <label className="field">
                <span>คำถาม</span>
                <textarea name="body" defaultValue={q.body} maxLength={2000} />
              </label>

              <p className="hint">แตะตัวอักษรหน้าตัวเลือกเพื่อกำหนดเป็นเฉลย (สีเขียว = เฉลย)</p>
              {LABELS.map((label, i) => (
                <div className="choice" key={label}>
                  <label className="tile" title={`ตั้งข้อ ${label} เป็นเฉลย`}>
                    <input type="radio" name="correct" value={label} defaultChecked={choices[i]?.is_correct ?? false}
                      aria-label={`เลือกข้อ ${label} เป็นเฉลย`} />
                    <span>{label}</span>
                  </label>
                  <input type="text" name={`c${i}`} defaultValue={choices[i]?.body ?? ""} maxLength={500}
                    placeholder={`ตัวเลือก ${label}`} aria-label={`ข้อความตัวเลือก ${label}`} />
                </div>
              ))}

              <div className="row" style={{ marginTop: ".75rem" }}>
                {set.scoring_mode === "custom" && (
                  <label className="field" style={{ flex: "0 0 160px" }}>
                    <span>คะแนนข้อนี้</span>
                    <input type="number" name="points" defaultValue={Number(q.points)} min="0.01" max="1000" step="0.01" required />
                  </label>
                )}
                <label className="field">
                  <span>คำอธิบายเฉลย (ไม่บังคับ)</span>
                  <textarea name="explanation" defaultValue={q.explanation ?? ""} maxLength={2000} style={{ minHeight: "3.5rem" }} />
                </label>
              </div>

              <div className="q-foot">
                <button className="btn primary" type="submit">บันทึกข้อนี้</button>
              </div>
            </form>
          </section>
        );
      })}

      <form action={addQuestion.bind(null, id)}>
        <button className="btn primary" type="submit">+ เพิ่มคำถาม</button>
      </form>
    </>
  );
}
