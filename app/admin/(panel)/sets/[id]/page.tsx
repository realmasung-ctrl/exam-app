import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/supabase/admin";
import { isUuid, LABELS } from "@/lib/validation";
import { deleteSet, markReady } from "@/lib/actions/sets";
import type { Choice, Problem, Question, QuestionSet } from "@/lib/types";
import type { EditorQuestion, EditorSettings, Label } from "@/lib/set-content";
import BackLink from "@/components/BackLink";
import ConfirmButton from "@/components/ConfirmButton";
import Flash from "@/components/Flash";
import SetEditor from "@/components/SetEditor";

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

  const initialSettings: EditorSettings = {
    title: set.title,
    instructions: set.instructions,
    scoring_mode: set.scoring_mode,
    equal_points: String(Number(set.equal_points)),
    default_reveal_mode: set.default_reveal_mode,
  };
  const initialQuestions: EditorQuestion[] = questions.map((q) => {
    const byLabel = (l: string): Choice | undefined => (q.answer_choices ?? []).find((c: Choice) => c.label === l);
    return {
      id: q.id,
      body: q.body,
      explanation: q.explanation ?? "",
      points: String(Number(q.points)),
      choices: LABELS.map((l) => byLabel(l)?.body ?? "") as [string, string, string, string],
      correct: (LABELS.find((l) => byLabel(l)?.is_correct) ?? null) as Label | null,
    };
  });

  return (
    <>
      <div className="page-head">
        <div>
          <BackLink href="/admin/sets">ชุดข้อสอบทั้งหมด</BackLink>
          <h1>{set.title}</h1>
          <p className="muted">
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

      {/* This panel reflects the last SAVED version; it refreshes by itself a moment after each save. */}
      {problems.length > 0 ? (
        <div className="problems" role="status">
          <strong>ยังเปิดสอบไม่ได้ — มี {problems.length} จุดที่ต้องแก้ (ตามที่บันทึกล่าสุด)</strong>
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

      <SetEditor key={set.id} setId={id} initialSettings={initialSettings} initialQuestions={initialQuestions} />
    </>
  );
}
