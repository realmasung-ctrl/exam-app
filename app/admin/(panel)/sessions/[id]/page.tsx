import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { serviceClient } from "@/lib/supabase/admin";
import { appBaseUrl } from "@/lib/url";
import { isUuid, isoToBangkokLocal } from "@/lib/validation";
import { fmtDate, REVEAL_LABEL, SESSION_STATUS_LABEL, statusBadgeClass } from "@/lib/format";
import {
  updateSession, openSession, deleteSession, closeEntry, reopenEntry, endSession,
} from "@/lib/actions/sessions";
import type { Problem } from "@/lib/types";
import ConfirmButton from "@/components/ConfirmButton";
import CopyButton from "@/components/CopyButton";
import Flash from "@/components/Flash";

type SessionFull = {
  id: string; set_id: string | null; title: string; duration_minutes: number;
  opens_at: string | null; closes_at: string | null; entry_closed_at: string | null;
  pass_percent: number | null; reveal_mode: string; require_student_code: boolean;
  expected_participants: number | null; status: string; public_code: string | null;
  snapshot_set_title: string | null; question_count: number | null; max_points: number | null;
  opened_at: string | null; ended_at: string | null; created_at: string;
  question_sets: { title: string } | null;
};

export default async function SessionPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { id } = await params;
  const { ok, err } = await searchParams;
  if (!isUuid(id)) notFound();

  const db = serviceClient();
  // grade anyone whose time ran out so the counts below are current
  await db.rpc("finalize_expired");

  const { data } = await db.from("exam_sessions").select("*, question_sets(title)").eq("id", id).maybeSingle();
  const s = data as SessionFull | null;
  if (!s) notFound();

  const isDraft = s.status === "draft";
  const isLive = s.status === "open" || s.status === "running";
  const editable = isDraft || isLive;

  const [partsRes, setsRes, probRes] = await Promise.all([
    db.from("exam_participants").select("status").eq("session_id", id).is("voided_at", null),
    isDraft ? db.from("question_sets").select("id, title").order("title") : Promise.resolve({ data: null }),
    isDraft && s.set_id ? db.rpc("validate_question_set", { p_set_id: s.set_id }) : Promise.resolve({ data: null }),
  ]);
  const parts = (partsRes.data ?? []) as { status: string }[];
  const sets = (setsRes.data ?? []) as { id: string; title: string }[];
  const problems = (probRes.data ?? []) as Problem[];

  const entered = parts.length;
  const inProgress = parts.filter((p) => p.status === "in_progress").length;
  const finished = entered - inProgress;
  const notStarted = s.expected_participants === null ? null : Math.max(s.expected_participants - entered, 0);

  let link = "";
  let qr = "";
  if (s.public_code) {
    link = `${await appBaseUrl()}/e/${s.public_code}`;
    if (isLive) qr = await QRCode.toDataURL(link, { width: 512, margin: 2, errorCorrectionLevel: "M" });
  }

  const setTitle = s.snapshot_set_title ?? s.question_sets?.title ?? "(ชุดข้อสอบถูกลบแล้ว)";

  return (
    <>
      <div className="page-head">
        <div>
          <p className="small" style={{ margin: 0 }}><Link href="/admin/sessions">← รอบสอบทั้งหมด</Link></p>
          <h1>{s.title}</h1>
          <p className="muted">
            ชุดข้อสอบ: {setTitle} ·{" "}
            <span className={`badge ${statusBadgeClass(s.status)}`}>{SESSION_STATUS_LABEL[s.status] ?? s.status}</span>
            {isLive && s.entry_closed_at && <span className="badge warn" style={{ marginLeft: ".4rem" }}>ปิดรับผู้เข้าสอบแล้ว</span>}
          </p>
        </div>
        {!isDraft && <Link className="btn primary" href={`/admin/results/${id}`}>ดูผลสอบ</Link>}
      </div>

      <Flash ok={ok} err={err} />

      {isLive && (
        <section className="panel share">
          <div>
            <h2>ลิงก์และ QR Code สำหรับผู้เรียน</h2>
            <code className="linkbox">{link}</code>
            <div className="actions" style={{ marginTop: ".75rem" }}>
              <CopyButton text={link} />
              <a className="btn" href={qr} download={`qr-${s.public_code}.png`}>ดาวน์โหลด QR Code</a>
              <a className="btn" href={link} target="_blank" rel="noreferrer">เปิดหน้าสอบ</a>
            </div>
            <p className="muted small" style={{ marginTop: ".75rem" }}>
              ลิงก์นี้ไม่มีเฉลยหรือข้อมูลภายในใดๆ ลองกด “เปิดหน้าสอบ” เพื่อตรวจว่าที่อยู่ถูกต้องก่อนแจกจริง
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={`QR Code สำหรับเข้ารอบสอบ ${s.title}`} width={220} height={220} />
        </section>
      )}

      {!isDraft && !isLive && s.public_code && (
        <div className="flash ok" style={{ background: "#eceff4", color: "var(--muted)" }}>
          รอบสอบนี้{SESSION_STATUS_LABEL[s.status]}แล้ว ลิงก์เดิมจะไม่อนุญาตให้เริ่มสอบใหม่
        </div>
      )}

      {!isDraft && (
        <section className="stats" aria-label="สรุปผู้เข้าสอบ">
          <div><b>{s.expected_participants ?? "-"}</b><span>ผู้เข้าสอบที่คาดไว้</span></div>
          <div><b>{entered}</b><span>เข้าระบบแล้ว</span></div>
          <div><b>{inProgress}</b><span>กำลังสอบ</span></div>
          <div><b>{finished}</b><span>ส่งแล้ว</span></div>
          <div><b>{notStarted ?? "-"}</b><span>ยังไม่เริ่ม</span></div>
        </section>
      )}

      {isLive && (
        <section className="panel">
          <h2>ควบคุมรอบสอบ</h2>
          <form className="actions">
            {s.entry_closed_at ? (
              <ConfirmButton action={reopenEntry.bind(null, id)} message="เปิดรับผู้เข้าสอบอีกครั้ง?" className="btn">
                เปิดรับผู้เข้าสอบอีกครั้ง
              </ConfirmButton>
            ) : (
              <ConfirmButton action={closeEntry.bind(null, id)}
                message="ปิดรับผู้เข้าสอบ? คนที่กำลังสอบอยู่ทำต่อได้ แต่คนใหม่จะเริ่มสอบไม่ได้"
                className="btn">
                ปิดรับผู้เข้าสอบ
              </ConfirmButton>
            )}
            <ConfirmButton
              action={endSession.bind(null, id, "ended")}
              message={`สิ้นสุดรอบสอบ?\n\nขณะนี้มีผู้กำลังสอบ ${inProgress} คน ระบบจะตรวจและส่งคำตอบล่าสุดที่บันทึกไว้ให้ทุกคนทันที และหลังจากนี้ไม่มีใครส่งคำตอบเพิ่มได้ ย้อนกลับไม่ได้`}
              className="btn danger"
            >
              สิ้นสุดรอบสอบ
            </ConfirmButton>
            <ConfirmButton
              action={endSession.bind(null, id, "disabled")}
              message={`ปิดใช้งานรอบสอบ?\n\nใช้เมื่อต้องการยกเลิกรอบสอบนี้ ผู้กำลังสอบ ${inProgress} คนจะถูกส่งคำตอบล่าสุดโดยอัตโนมัติ และลิงก์จะใช้ไม่ได้ ย้อนกลับไม่ได้`}
              className="btn danger"
            >
              ปิดใช้งาน
            </ConfirmButton>
          </form>
        </section>
      )}

      {isDraft && problems.length > 0 && (
        <div className="problems" role="status">
          <strong>เปิดรอบสอบไม่ได้ — ชุดข้อสอบยังไม่ครบถ้วน ({problems.length} จุด)</strong>
          <ul>
            {problems.map((p, i) => (
              <li key={i}>{p.question_position > 0 ? `ข้อ ${p.question_position}: ` : ""}{p.problem}</li>
            ))}
          </ul>
          {s.set_id && <p style={{ margin: ".5rem 0 0" }}><Link href={`/admin/sets/${s.set_id}`}>ไปแก้ไขชุดข้อสอบ</Link></p>}
        </div>
      )}

      <form action={updateSession.bind(null, id)} className="panel">
        <h2>{isDraft ? "ตั้งค่ารอบสอบ" : "การตั้งค่ารอบสอบ"}</h2>
        {!isDraft && editable && (
          <p className="muted small">
            เปิดรอบแล้ว จึงแก้ได้เฉพาะชื่อ เวลาปิดรับ การแสดงเฉลย และจำนวนที่คาดไว้ (ชุดข้อสอบ เวลาสอบ และเกณฑ์ผ่านถูกล็อกเพื่อให้ผลสอบถูกต้อง
            ถ้าต้องการเปลี่ยน ให้สร้างรอบสอบใหม่)
          </p>
        )}
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <label className="field">
            <span>ชื่อรอบสอบ</span>
            <input type="text" name="title" defaultValue={s.title} maxLength={200} required />
          </label>
          <div className="row">
            <label className="field">
              <span>ชุดข้อสอบ</span>
              {isDraft ? (
                <select name="set_id" defaultValue={s.set_id ?? ""} required>
                  <option value="" disabled>— เลือกชุดข้อสอบ —</option>
                  {sets.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                </select>
              ) : (
                <input type="text" value={setTitle} readOnly disabled />
              )}
            </label>
            <label className="field" style={{ flex: "0 1 160px" }}>
              <span>เวลาสอบ (นาที)</span>
              <input type="number" name="duration_minutes" defaultValue={s.duration_minutes} min={1} max={600} step={1}
                required disabled={!isDraft} />
            </label>
            <label className="field" style={{ flex: "0 1 200px" }}>
              <span>เกณฑ์ผ่าน (% ไม่บังคับ)</span>
              <input type="number" name="pass_percent" defaultValue={s.pass_percent ?? ""} min={0} max={100} step="0.01"
                placeholder="เช่น 60" disabled={!isDraft} />
            </label>
          </div>
          <div className="row">
            <label className="field">
              <span>เริ่มเปิดรับผู้เข้าสอบ (เวลาไทย ไม่บังคับ)</span>
              <input type="datetime-local" name="opens_at" defaultValue={isoToBangkokLocal(s.opens_at)} disabled={!isDraft} />
            </label>
            <label className="field">
              <span>ปิดรับผู้เข้าสอบ (เวลาไทย ไม่บังคับ)</span>
              <input type="datetime-local" name="closes_at" defaultValue={isoToBangkokLocal(s.closes_at)} />
            </label>
          </div>
          <div className="row">
            <label className="field">
              <span>การแสดงเฉลยหลังสอบ</span>
              <select name="reveal_mode" defaultValue={s.reveal_mode}>
                {Object.entries(REVEAL_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
            <label className="field" style={{ flex: "0 1 220px" }}>
              <span>จำนวนผู้เข้าสอบที่คาดไว้ (ไม่บังคับ)</span>
              <input type="number" name="expected_participants" defaultValue={s.expected_participants ?? ""} min={0} step={1} />
            </label>
          </div>
          <label className="field" style={{ display: "flex", gap: ".6rem", alignItems: "center" }}>
            <input type="checkbox" name="require_student_code" defaultChecked={s.require_student_code} disabled={!isDraft}
              style={{ width: 22, height: 22 }} />
            <span style={{ margin: 0 }}>บังคับให้กรอกรหัสประจำตัวผู้เรียน</span>
          </label>
        </fieldset>

        {!isDraft && (
          <p className="muted small">
            {s.question_count ?? 0} ข้อ · คะแนนเต็ม {s.max_points ?? 0} · เปิดรอบเมื่อ {fmtDate(s.opened_at)}
            {s.ended_at ? ` · สิ้นสุดเมื่อ ${fmtDate(s.ended_at)}` : ""}
          </p>
        )}

        {editable && (
          <div className="actions">
            <button className="btn" type="submit">บันทึกการตั้งค่า</button>
            {isDraft && (
              <ConfirmButton
                action={openSession.bind(null, id)}
                message={"เปิดรอบสอบ?\n\nเมื่อเปิดแล้ว คำถาม เฉลย และคะแนนของรอบนี้จะถูกล็อก ถ้าต้องแก้ไข ต้องสร้างรอบสอบใหม่"}
                className="btn primary"
                disabled={problems.length > 0 || !s.set_id}
              >
                บันทึกและเปิดรอบสอบ
              </ConfirmButton>
            )}
            {isDraft && (
              <ConfirmButton action={deleteSession.bind(null, id)} message="ลบรอบสอบฉบับร่างนี้?" className="btn danger">
                ลบรอบสอบนี้
              </ConfirmButton>
            )}
          </div>
        )}
      </form>
    </>
  );
}
