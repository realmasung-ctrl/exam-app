import Link from "next/link";
import { serviceClient } from "@/lib/supabase/admin";
import { fmtDate } from "@/lib/format";

export default async function Dashboard() {
  const db = serviceClient();
  const [{ count }, { data: recent }, { data: live }] = await Promise.all([
    db.from("question_sets").select("id", { count: "exact", head: true }),
    db.from("question_sets").select("id, title, status, updated_at").order("updated_at", { ascending: false }).limit(5),
    db.from("exam_sessions").select("id, title, status").in("status", ["open", "running"]).order("created_at", { ascending: false }).limit(5),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>หน้าหลัก</h1>
          <p className="muted">ตอนนี้มีชุดข้อสอบ {count ?? 0} ชุด</p>
        </div>
        <Link className="btn primary" href="/admin/sets">จัดการชุดข้อสอบ</Link>
      </div>

      <section className="panel">
        <h2>รอบสอบที่เปิดอยู่</h2>
        {live && live.length > 0 ? (
          <ul className="list">
            {live.map((x: { id: string; title: string; status: string }) => (
              <li key={x.id}>
                <Link className="title" href={`/admin/sessions/${x.id}`}>{x.title}</Link>
                <span className="badge ok">{x.status === "running" ? "กำลังสอบ" : "เปิดรับผู้เข้าสอบ"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">ยังไม่มีรอบสอบที่เปิดอยู่ <Link href="/admin/sessions">สร้างรอบสอบ</Link></p>
        )}
      </section>

      <section className="panel">
        <h2>ชุดข้อสอบที่แก้ไขล่าสุด</h2>
        {recent && recent.length > 0 ? (
          <ul className="list">
            {recent.map((s: { id: string; title: string; status: string; updated_at: string }) => (
              <li key={s.id}>
                <Link className="title" href={`/admin/sets/${s.id}`}>{s.title}</Link>
                <span className="muted small">แก้ไขเมื่อ {fmtDate(s.updated_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">ยังไม่มีชุดข้อสอบ เริ่มต้นโดยสร้างชุดแรกที่เมนู “ชุดข้อสอบ”</p>
        )}
      </section>
    </>
  );
}
