import Link from "next/link";
import { serviceClient } from "@/lib/supabase/admin";
import { fmtDate, SESSION_STATUS_LABEL, statusBadgeClass } from "@/lib/format";
import Flash from "@/components/Flash";

type S = {
  id: string; title: string; status: string; created_at: string; opened_at: string | null;
  snapshot_set_title: string | null; expected_participants: number | null;
};

export default async function ResultsIndex({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { ok, err } = await searchParams;
  const db = serviceClient();
  await db.rpc("finalize_expired");

  const [sRes, pRes] = await Promise.all([
    db.from("exam_sessions")
      .select("id, title, status, created_at, opened_at, snapshot_set_title, expected_participants")
      .neq("status", "draft").order("created_at", { ascending: false }),
    db.from("exam_participants").select("session_id, status").is("voided_at", null),
  ]);
  const sessions = (sRes.data ?? []) as S[];
  const stats = new Map<string, { entered: number; inProgress: number }>();
  for (const p of (pRes.data ?? []) as { session_id: string; status: string }[]) {
    const cur = stats.get(p.session_id) ?? { entered: 0, inProgress: 0 };
    cur.entered += 1;
    if (p.status === "in_progress") cur.inProgress += 1;
    stats.set(p.session_id, cur);
  }

  return (
    <>
      <div className="page-head"><h1>ผลสอบ</h1></div>
      <Flash ok={ok} err={err} />
      <section className="panel">
        {sessions.length === 0 ? (
          <p className="muted">ยังไม่มีรอบสอบที่เปิดใช้งาน ผลสอบจะปรากฏที่นี่หลังมีผู้เข้าสอบ</p>
        ) : (
          <ul className="list">
            {sessions.map((s) => {
              const st = stats.get(s.id) ?? { entered: 0, inProgress: 0 };
              return (
                <li key={s.id}>
                  <div>
                    <Link className="title" href={`/admin/results/${s.id}`}>{s.title}</Link>
                    <div className="muted small">
                      {s.snapshot_set_title ?? ""} · เข้าสอบ {st.entered} คน · กำลังสอบ {st.inProgress} คน · เปิดเมื่อ {fmtDate(s.opened_at ?? s.created_at)}
                    </div>
                  </div>
                  <span className={`badge ${statusBadgeClass(s.status)}`}>{SESSION_STATUS_LABEL[s.status] ?? s.status}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
