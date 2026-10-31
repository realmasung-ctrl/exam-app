import { serviceClient } from "@/lib/supabase/admin";
import { runSystemChecks } from "@/lib/syscheck";
import { summarize } from "@/lib/syscheck-logic";
import { BACKUP_TABLES } from "@/lib/backup-logic";

const ICON = { ok: "✅", warn: "⚠️", fail: "❌" } as const;
const TABLE_LABEL: Record<string, string> = {
  question_sets: "ชุดข้อสอบ", questions: "คำถาม", answer_choices: "ตัวเลือก", exam_sessions: "รอบสอบ",
  session_questions: "คำถามในรอบสอบ", session_choices: "ตัวเลือกในรอบสอบ", exam_participants: "ผู้เข้าสอบ",
  participant_answers: "คำตอบ", exam_results: "ผลคะแนน",
};

export default async function SystemPage() {
  const db = serviceClient();
  const [checks, counts] = await Promise.all([
    runSystemChecks(),
    Promise.all(BACKUP_TABLES.map(async (t) => {
      const { count } = await db.from(t.name).select("*", { count: "exact", head: true });
      return { name: t.name, count: count ?? 0 };
    })),
  ]);
  const sum = summarize(checks);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>ตรวจสอบระบบ / สำรองข้อมูล</h1>
          <p className="muted">ใช้ตรวจความพร้อมก่อนวันสอบ และสำรองข้อมูลเก็บไว้เอง</p>
        </div>
      </div>

      <section className="panel">
        <h2>ตรวจสอบความพร้อมของระบบ</h2>
        <div className={`flash ${sum.fail > 0 ? "err" : sum.warn > 0 ? "warn" : "ok"}`} role="status">
          {sum.fail > 0
            ? `พบ ${sum.fail} รายการที่ต้องแก้ก่อนใช้งานจริง`
            : sum.warn > 0
              ? `ใช้งานได้ แต่มี ${sum.warn} รายการที่ควรตรวจ`
              : "ทุกรายการปกติ"}
        </div>
        <ul className="list">
          {checks.map((c) => (
            <li key={c.id}>
              <div>
                <strong>{ICON[c.status]} {c.label}</strong>
                <div className="muted small">{c.detail}</div>
              </div>
            </li>
          ))}
        </ul>
        <p className="muted small" style={{ marginBottom: 0 }}>
          รายการที่หน้านี้ตรวจเองไม่ได้ (งานตั้งเวลา pg_cron และสิทธิ์ฐานข้อมูล) ให้รัน <code>supabase/tests/security.sql</code> ใน Supabase SQL Editor
        </p>
      </section>

      <section className="panel">
        <h2>สำรองข้อมูล</h2>
        <div className="flash warn" role="note">
          Supabase แพ็กเกจฟรี <strong>ไม่มีการสำรองข้อมูลอัตโนมัติ</strong> ถ้าข้อมูลหาย กู้คืนได้เฉพาะจากไฟล์ที่คุณดาวน์โหลดเก็บไว้เอง
          แนะนำให้สำรอง <strong>ทุกครั้งหลังจบรอบสอบ</strong> และอย่างน้อยสัปดาห์ละครั้ง
        </div>
        <p>ไฟล์สำรองมีข้อมูลทั้งหมดในระบบ ได้แก่</p>
        <ul className="small" style={{ columns: 2, margin: "0 0 1rem", paddingLeft: "1.2rem" }}>
          {counts.map((c) => <li key={c.name}>{TABLE_LABEL[c.name] ?? c.name}: <strong>{c.count}</strong></li>)}
        </ul>
        <p className="actions">
          <a className="btn primary" href="/api/admin/backup">ดาวน์โหลดไฟล์สำรองข้อมูลทั้งหมด (.json)</a>
        </p>
        <ul className="small muted" style={{ paddingLeft: "1.2rem" }}>
          <li>ควรสำรองตอน <strong>ไม่มีรอบสอบที่กำลังสอบอยู่</strong> เพื่อให้ไฟล์สอดคล้องกัน</li>
          <li>ไฟล์มี <strong>ชื่อผู้เข้าสอบ เฉลย และผลคะแนน</strong> เก็บในที่ปลอดภัย อย่าส่งทางแชตสาธารณะ (แนะนำบีบอัดเป็น zip ตั้งรหัสผ่าน)</li>
          <li>เก็บอย่างน้อย 2 ที่ (เช่น คอมพิวเตอร์ + ไดรฟ์ขององค์กร) ตั้งชื่อไฟล์ให้มีวันที่ (ระบบใส่ให้แล้ว)</li>
          <li>ถ้าดาวน์โหลดไม่สำเร็จหรือไฟล์ถูกตัดกลางคัน ไฟล์นั้นจะเปิดอ่านไม่ได้ ให้ดาวน์โหลดใหม่</li>
          <li>ผลสอบรายรอบ ส่งออกเป็น Excel/CSV ได้ที่หน้า “ผลสอบ” (อ่านง่ายกว่า แต่ไม่ใช่ไฟล์สำหรับกู้คืน)</li>
          <li>วิธีกู้คืนอยู่ใน <code>docs/OPERATIONS.md</code> (ใช้สคริปต์ <code>scripts/restore-backup.mjs</code>)</li>
        </ul>
      </section>
    </>
  );
}
