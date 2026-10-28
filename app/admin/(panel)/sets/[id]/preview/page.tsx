import Link from "next/link";
import { notFound } from "next/navigation";
import { serviceClient } from "@/lib/supabase/admin";
import { isUuid, LABELS } from "@/lib/validation";
import PreviewExam from "@/components/PreviewExam";

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const db = serviceClient();
  const [{ data: set }, { data: qs }] = await Promise.all([
    db.from("question_sets").select("title, instructions, scoring_mode, equal_points").eq("id", id).maybeSingle(),
    // correct answers are deliberately NOT selected: this is exactly what a student would receive
    db.from("questions").select("id, body, points, position, answer_choices(label, body)").eq("set_id", id).order("position"),
  ]);
  if (!set) notFound();

  const questions = (qs ?? []).map((q: { id: string; body: string; points: number; answer_choices: { label: string; body: string }[] }) => ({
    id: q.id,
    body: q.body,
    points: set.scoring_mode === "equal" ? Number(set.equal_points) : Number(q.points),
    choices: LABELS.map((l) => ({ label: l as string, body: q.answer_choices?.find((c) => c.label === l)?.body ?? "" })),
  }));

  return (
    <>
      <p className="small"><Link href={`/admin/sets/${id}`}>← กลับไปแก้ไขชุดข้อสอบ</Link></p>
      <div className="pv-banner" role="note">โหมดตัวอย่าง — ไม่บันทึกคำตอบ ไม่มีผลกับข้อมูลจริง และไม่แสดงเฉลย</div>
      <PreviewExam title={set.title} instructions={set.instructions} questions={questions} />
    </>
  );
}
