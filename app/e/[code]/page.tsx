import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/supabase/admin";
import { CODE_RE, SESSION_COLS, loadAttempt, type PublicSession } from "@/lib/exam";
import { startExam } from "@/lib/actions/exam";
import StartButton from "@/components/StartButton";

export const metadata: Metadata = { title: "เข้าร่วมการสอบ", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const START_ERR: Record<string, string> = {
  NAME_REQUIRED: "กรุณากรอกชื่อและนามสกุลให้ครบ",
  CODE_INVALID: "รหัสประจำตัวยาวเกินไป",
  STUDENT_CODE_REQUIRED: "รอบสอบนี้ต้องกรอกรหัสประจำตัว",
  SESSION_CLOSED: "รอบสอบนี้ปิดรับผู้เข้าสอบแล้ว",
  ENTRY_CLOSED: "รอบสอบนี้ปิดรับผู้เข้าสอบแล้ว",
  SESSION_NOT_YET_OPEN: "ยังไม่ถึงเวลาเปิดรับผู้เข้าสอบ",
  SESSION_NOT_FOUND: "ไม่พบรอบสอบ กรุณาตรวจสอบลิงก์",
  SESSION_FULL: "รอบสอบนี้มีผู้เข้าสอบเต็มจำนวนแล้ว กรุณาแจ้งผู้ดูแลการสอบ",
  ALREADY_STARTED:
    "ชื่อนี้เข้าสอบรอบนี้ไปแล้ว ถ้าคุณเปลี่ยนเครื่องหรือเบราว์เซอร์ กรุณาแจ้งผู้ดูแลการสอบ",
};

export default async function JoinPage({
  params, searchParams,
}: { params: Promise<{ code: string }>; searchParams: Promise<{ err?: string }> }) {
  const { code } = await params;
  const { err } = await searchParams;

  if (!CODE_RE.test(code)) return <NotFound />;

  // Same browser coming back (refresh, closed tab, opened the link again): never start a new attempt.
  const mine = await loadAttempt(code);
  if (mine) redirect(mine.participant.status === "in_progress" ? `/e/${code}/take` : `/e/${code}/result`);

  const { data } = await serviceClient().from("exam_sessions").select(SESSION_COLS).eq("public_code", code).maybeSingle();
  const s = (data as PublicSession | null) ?? null;
  if (!s) return <NotFound />;

  const now = Date.now();
  const notYet = s.opens_at !== null && now < new Date(s.opens_at).getTime();
  const closed =
    !["open", "running"].includes(s.status) ||
    s.entry_closed_at !== null ||
    (s.closes_at !== null && now >= new Date(s.closes_at).getTime());

  const errMsg = err ? (START_ERR[err] ?? "เริ่มการสอบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง") : null;

  return (
    <main className="login">
      <div className="panel" style={{ width: "min(560px, 100%)" }}>
        <h1>{s.snapshot_set_title ?? s.title}</h1>
        <p className="muted">{s.title}</p>
        {s.snapshot_instructions && <p style={{ whiteSpace: "pre-wrap" }}>{s.snapshot_instructions}</p>}
        <p className="muted">
          {s.question_count ?? 0} ข้อ · เวลาสอบ {s.duration_minutes} นาที · คะแนนเต็ม {s.max_points ?? 0}
          {s.pass_percent !== null ? ` · เกณฑ์ผ่าน ${s.pass_percent}%` : ""}
        </p>

        {errMsg && <div className="flash err" role="alert">{errMsg}</div>}

        {closed ? (
          <div className="flash err" role="alert">รอบสอบนี้ปิดรับผู้เข้าสอบแล้ว</div>
        ) : notYet ? (
          <div className="flash err" role="alert">ยังไม่ถึงเวลาเปิดรับผู้เข้าสอบ</div>
        ) : (
          <form action={startExam.bind(null, code)}>
            <label className="field">
              <span>ชื่อ</span>
              <input type="text" name="first_name" maxLength={100} required autoComplete="given-name" />
            </label>
            <label className="field">
              <span>นามสกุล</span>
              <input type="text" name="last_name" maxLength={100} required autoComplete="family-name" />
            </label>
            <label className="field">
              <span>รหัสประจำตัว{s.require_student_code ? "" : " (ไม่บังคับ)"}</span>
              <input type="text" name="student_code" maxLength={50} required={s.require_student_code} autoComplete="off" />
            </label>
            <p className="small muted">
              เมื่อกด “เริ่มทำข้อสอบ” เวลาจะเริ่มนับทันทีและหยุดไม่ได้ ถ้าหน้าเว็บค้างหรือปิดไป ให้เปิดลิงก์เดิมในเบราว์เซอร์เดิมเพื่อทำต่อ
            </p>
            <StartButton>เริ่มทำข้อสอบ</StartButton>
          </form>
        )}
      </div>
    </main>
  );
}

function NotFound() {
  return (
    <main className="login">
      <div className="panel">
        <h1>ไม่พบรอบสอบ</h1>
        <p className="muted">ลิงก์ไม่ถูกต้อง กรุณาตรวจสอบกับผู้ดูแลการสอบ</p>
      </div>
    </main>
  );
}
