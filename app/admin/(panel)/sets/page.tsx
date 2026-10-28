import Link from "next/link";
import { serviceClient } from "@/lib/supabase/admin";
import { createSet } from "@/lib/actions/sets";
import { fmtDate } from "@/lib/format";
import Flash from "@/components/Flash";

type Row = {
  id: string; title: string; status: string; scoring_mode: string;
  updated_at: string; questions: { count: number }[];
};

export default async function SetsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { ok, err } = await searchParams;
  const { data } = await serviceClient()
    .from("question_sets")
    .select("id, title, status, scoring_mode, updated_at, questions(count)")
    .order("updated_at", { ascending: false });
  const sets = (data ?? []) as Row[];

  return (
    <>
      <div className="page-head">
        <h1>ชุดข้อสอบ</h1>
      </div>
      <Flash ok={ok} err={err} />

      <form action={createSet} className="panel">
        <h2>สร้างชุดข้อสอบใหม่</h2>
        <div className="row">
          <label className="field" style={{ margin: 0 }}>
            <span>ชื่อชุดข้อสอบ</span>
            <input type="text" name="title" maxLength={200} required />
          </label>
          <button className="btn primary" type="submit">สร้างชุดข้อสอบ</button>
        </div>
      </form>

      <section className="panel">
        {sets.length === 0 ? (
          <p className="muted">ยังไม่มีชุดข้อสอบ ตั้งชื่อชุดแรกด้านบนแล้วกดสร้างได้เลย</p>
        ) : (
          <ul className="list">
            {sets.map((s) => (
              <li key={s.id}>
                <div>
                  <Link className="title" href={`/admin/sets/${s.id}`}>{s.title}</Link>
                  <div className="muted small">
                    {s.questions?.[0]?.count ?? 0} ข้อ · {s.scoring_mode === "equal" ? "คะแนนเท่ากันทุกข้อ" : "กำหนดคะแนนรายข้อ"} · แก้ไข {fmtDate(s.updated_at)}
                  </div>
                </div>
                <span className={`badge ${s.status === "ready" ? "ok" : ""}`}>
                  {s.status === "ready" ? "พร้อมใช้งาน" : "ฉบับร่าง"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
