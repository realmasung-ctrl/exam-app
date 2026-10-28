import type { Metadata } from "next";
import { serviceClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "เข้าร่วมการสอบ", robots: { index: false, follow: false } };

type PublicSession = {
  title: string; snapshot_set_title: string | null; snapshot_instructions: string | null;
  duration_minutes: number; question_count: number | null; max_points: number | null;
  status: string; entry_closed_at: string | null; opens_at: string | null; closes_at: string | null;
  require_student_code: boolean;
};

// Phase 4 placeholder of the student's first screen: it proves that the link/QR points
// to the right session. Only public, non-sensitive fields are selected (never answers).
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let s: PublicSession | null = null;

  if (/^[0-9a-f]{16}$/.test(code)) {
    const { data } = await serviceClient()
      .from("exam_sessions")
      .select("title, snapshot_set_title, snapshot_instructions, duration_minutes, question_count, max_points, status, entry_closed_at, opens_at, closes_at, require_student_code")
      .eq("public_code", code)
      .maybeSingle();
    s = (data as PublicSession | null) ?? null;
  }

  if (!s) {
    return (
      <main className="login">
        <div className="panel">
          <h1>ไม่พบรอบสอบ</h1>
          <p className="muted">ลิงก์ไม่ถูกต้อง กรุณาตรวจสอบกับผู้ดูแลการสอบ</p>
        </div>
      </main>
    );
  }

  const now = Date.now();
  const notYet = s.opens_at !== null && now < new Date(s.opens_at).getTime();
  const closed =
    !["open", "running"].includes(s.status) ||
    s.entry_closed_at !== null ||
    (s.closes_at !== null && now >= new Date(s.closes_at).getTime());

  return (
    <main className="login">
      <div className="panel" style={{ width: "min(560px, 100%)" }}>
        <h1>{s.snapshot_set_title ?? s.title}</h1>
        <p className="muted">{s.title}</p>
        {s.snapshot_instructions && <p style={{ whiteSpace: "pre-wrap" }}>{s.snapshot_instructions}</p>}
        <p className="muted">
          {s.question_count ?? 0} ข้อ · เวลาสอบ {s.duration_minutes} นาที · คะแนนเต็ม {s.max_points ?? 0}
        </p>
        {closed ? (
          <div className="flash err" role="alert">รอบสอบนี้ปิดรับผู้เข้าสอบแล้ว</div>
        ) : notYet ? (
          <div className="flash err" role="alert">ยังไม่ถึงเวลาเปิดรับผู้เข้าสอบ</div>
        ) : (
          <div className="flash ok" role="status">
            ลิงก์ถูกต้อง — หน้ากรอกชื่อและเริ่มทำข้อสอบจะเปิดใช้งานในขั้นตอนถัดไป (Phase 5)
          </div>
        )}
      </div>
    </main>
  );
}
