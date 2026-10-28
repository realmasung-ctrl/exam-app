import Link from "next/link";
import { serviceClient } from "@/lib/supabase/admin";
import { createSession } from "@/lib/actions/sessions";
import { fmtDate, SESSION_STATUS_LABEL, statusBadgeClass } from "@/lib/format";
import Flash from "@/components/Flash";

type SessionRow = {
  id: string; title: string; status: string; duration_minutes: number; created_at: string;
  snapshot_set_title: string | null; question_sets: { title: string } | null;
};
type SetRow = { id: string; title: string; questions: { count: number }[] };

export default async function SessionsPage({
  searchParams,
}: { searchParams: Promise<{ ok?: string; err?: string; set?: string }> }) {
  const { ok, err, set } = await searchParams;
  const db = serviceClient();

  const [setsRes, sessRes] = await Promise.all([
    db.from("question_sets").select("id, title, questions(count)").order("title"),
    db.from("exam_sessions")
      .select("id, title, status, duration_minutes, created_at, snapshot_set_title, question_sets(title)")
      .order("created_at", { ascending: false }),
  ]);
  const sets = (setsRes.data ?? []) as unknown as SetRow[];
  const sessions = (sessRes.data ?? []) as unknown as SessionRow[];

  return (
    <>
      <div className="page-head"><h1>รอบสอบ</h1></div>
      <Flash ok={ok} err={err} />

      <form action={createSession} className="panel">
        <h2>สร้างรอบสอบใหม่</h2>
        {sets.length === 0 ? (
          <p className="muted">ต้องมีชุดข้อสอบก่อน <Link href="/admin/sets">ไปสร้างชุดข้อสอบ</Link></p>
        ) : (
          <>
            <div className="row">
              <label className="field">
                <span>ชุดข้อสอบที่ใช้</span>
                <select name="set_id" defaultValue={set ?? ""} required>
                  <option value="" disabled>— เลือกชุดข้อสอบ —</option>
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>{s.title} ({s.questions?.[0]?.count ?? 0} ข้อ)</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>ชื่อรอบสอบ</span>
                <input type="text" name="title" maxLength={200} required placeholder="เช่น อบรมความปลอดภัย รอบเช้า" />
              </label>
              <label className="field" style={{ flex: "0 1 140px" }}>
                <span>เวลาสอบ (นาที)</span>
                <input type="number" name="duration_minutes" defaultValue={15} min={1} max={600} step={1} required />
              </label>
            </div>
            <button className="btn primary" type="submit">สร้างรอบสอบ</button>
            <p className="muted small" style={{ marginTop: ".75rem" }}>
              ชุดข้อสอบเดียวใช้เปิดได้หลายรอบ แต่ละรอบแยกผู้เข้าสอบและคะแนนออกจากกัน
            </p>
          </>
        )}
      </form>

      <section className="panel">
        {sessions.length === 0 ? (
          <p className="muted">ยังไม่มีรอบสอบ</p>
        ) : (
          <ul className="list">
            {sessions.map((s) => (
              <li key={s.id}>
                <div>
                  <Link className="title" href={`/admin/sessions/${s.id}`}>{s.title}</Link>
                  <div className="muted small">
                    {s.snapshot_set_title ?? s.question_sets?.title ?? "(ชุดข้อสอบถูกลบแล้ว)"} · {s.duration_minutes} นาที · สร้าง {fmtDate(s.created_at)}
                  </div>
                </div>
                <span className={`badge ${statusBadgeClass(s.status)}`}>{SESSION_STATUS_LABEL[s.status] ?? s.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
