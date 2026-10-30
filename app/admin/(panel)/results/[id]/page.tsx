import Link from "next/link";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/validation";
import { loadSessionResults } from "@/lib/results";
import { allowRetake } from "@/lib/actions/results";
import {
  STATUS_LABEL, filterSortRows, formatBangkok, formatMinSec, parseSortDir, parseSortKey, parseStatusFilter, summarize,
} from "@/lib/results-logic";
import { SESSION_STATUS_LABEL, statusBadgeClass } from "@/lib/format";
import AutoRefresh from "@/components/AutoRefresh";
import ConfirmButton from "@/components/ConfirmButton";
import Flash from "@/components/Flash";
import DangerConfirm from "@/components/DangerConfirm";
import { deleteFinishedSession } from "@/lib/actions/results";
import BackLink from "@/components/BackLink";

type SP = { ok?: string; err?: string; q?: string; status?: string; sort?: string; dir?: string };

export default async function ResultsPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();

  const data = await loadSessionResults(id);
  if (!data) notFound();
  const { session: s, rows, voidedCount, error: loadError } = data;

  const q = (sp.q ?? "").slice(0, 100);
  const status = parseStatusFilter(sp.status);
  const sort = parseSortKey(sp.sort);
  const dir = parseSortDir(sp.dir);
  const shown = filterSortRows(rows, { q, status, sort, dir });
  const sum = summarize(rows, s.expected_participants);
  const live = s.status === "open" || s.status === "running" || sum.inProgress > 0;
  const canRetake = (s.status === "open" || s.status === "running");
  const hasPass = s.pass_percent !== null;

  return (
    <>
      {live && <AutoRefresh intervalMs={5000} />}
      <div className="page-head">
        <div>
          <BackLink href="/admin/results">ผลสอบทั้งหมด</BackLink>
          <h1>ผลสอบ: {s.title}</h1>
          <p className="muted">
            <span className={`badge ${statusBadgeClass(s.status)}`}>{SESSION_STATUS_LABEL[s.status] ?? s.status}</span>{" "}
            {s.question_count ?? 0} ข้อ · คะแนนเต็ม {s.max_points ?? 0}
            {hasPass ? ` · เกณฑ์ผ่าน ${s.pass_percent}%` : ""}
            {live ? " · อัปเดตอัตโนมัติทุก 5 วินาที" : ""}
          </p>
        </div>
        <div className="actions no-print">
          <Link className="btn" href={`/admin/sessions/${s.id}`}>จัดการรอบสอบ</Link>
          <a className="btn" href={`/api/admin/sessions/${s.id}/export?format=xlsx`}>ส่งออก Excel</a>
          <a className="btn" href={`/api/admin/sessions/${s.id}/export?format=csv`}>ส่งออก CSV</a>
          {(s.status === "ended" || s.status === "disabled") && (
            <DangerConfirm
              action={deleteFinishedSession.bind(null, s.id)}
              triggerLabel="ลบรอบสอบนี้"
              title={`ลบรอบสอบ “${s.title}”?`}
              confirmLabel="ลบรอบสอบและผลสอบทั้งหมด"
              ackLabel="ฉันเข้าใจว่าลบแล้วกู้คืนไม่ได้ และได้ส่งออกผลสอบไว้แล้วหากต้องการเก็บ"
            >
              <p>จะลบ <strong>ถาวร</strong>: รอบสอบนี้ ผู้เข้าสอบ {sum.entered} คน คำตอบทุกข้อ ผลคะแนน และสำเนาข้อสอบของรอบนี้</p>
              <p className="small muted">ชุดข้อสอบต้นฉบับไม่ถูกลบ ก่อนลบแนะนำให้ส่งออกผลสอบเก็บไว้:</p>
              <p className="actions">
                <a className="btn small-btn" href={`/api/admin/sessions/${s.id}/export?format=xlsx`}>ส่งออก Excel</a>
                <a className="btn small-btn" href={`/api/admin/sessions/${s.id}/export?format=csv`}>ส่งออก CSV</a>
              </p>
            </DangerConfirm>
          )}
        </div>
      </div>

      <Flash ok={sp.ok} err={sp.err ?? loadError ?? undefined} />

      <section className="stats" aria-label="สรุปผู้เข้าสอบ">
        <div><b>{s.expected_participants ?? "-"}</b><span>ผู้เข้าสอบที่คาดไว้</span></div>
        <div><b>{sum.entered}</b><span>เข้าร่วม</span></div>
        <div><b>{sum.inProgress}</b><span>กำลังสอบ</span></div>
        <div><b>{sum.finished}</b><span>ส่งแล้ว</span></div>
        <div><b>{sum.notStarted ?? "-"}</b><span>ยังไม่เริ่ม</span></div>
        <div><b>{sum.avgPercent === null ? "-" : `${sum.avgPercent}%`}</b><span>คะแนนเฉลี่ย (ที่ส่งแล้ว)</span></div>
        {hasPass && <div><b>{sum.passedCount}/{sum.passedCount + sum.failedCount}</b><span>ผ่านเกณฑ์</span></div>}
      </section>

      <form method="get" className="panel filters no-print">
        <label className="field"><span>ค้นหาชื่อ / รหัส</span>
          <input type="text" name="q" defaultValue={q} maxLength={100} placeholder="พิมพ์ชื่อ นามสกุล หรือรหัส" /></label>
        <label className="field"><span>กรองสถานะ</span>
          <select name="status" defaultValue={status}>
            <option value="all">ทั้งหมด</option>
            <option value="in_progress">กำลังสอบ (ยังไม่ส่ง)</option>
            <option value="submitted">ส่งด้วยตนเอง</option>
            <option value="timed_out">หมดเวลา</option>
            <option value="closed_by_admin">ผู้ดูแลปิดรอบสอบ</option>
            {hasPass && <option value="passed">ผ่านเกณฑ์</option>}
            {hasPass && <option value="failed">ไม่ผ่านเกณฑ์</option>}
          </select></label>
        <label className="field"><span>เรียงตาม</span>
          <select name="sort" defaultValue={sort}>
            <option value="started">ลำดับการเข้าสอบ</option>
            <option value="name">ชื่อ</option>
            <option value="score">คะแนน</option>
            <option value="percent">เปอร์เซ็นต์</option>
            <option value="duration">เวลาที่ใช้</option>
          </select></label>
        <label className="field"><span>ทิศทาง</span>
          <select name="dir" defaultValue={dir}>
            <option value="asc">น้อย → มาก</option>
            <option value="desc">มาก → น้อย</option>
          </select></label>
        <div className="actions" style={{ alignSelf: "end", marginBottom: ".75rem" }}>
          <button className="btn primary" type="submit">ใช้ตัวกรอง</button>
          <Link className="btn" href={`/admin/results/${s.id}`}>ล้าง</Link>
        </div>
      </form>

      {voidedCount > 0 && (
        <p className="muted small">มี {voidedCount} รายการที่ถูกอนุญาตให้สอบใหม่ (เก็บไว้ตรวจสอบ ไม่แสดงในตารางและไฟล์ส่งออก)</p>
      )}

      {rows.length === 0 ? (
        <section className="panel"><p className="muted">ยังไม่มีผู้เข้าสอบ</p></section>
      ) : shown.length === 0 ? (
        <section className="panel"><p className="muted">ไม่พบรายการที่ตรงกับตัวกรอง</p></section>
      ) : (
        <div className="tablewrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>ลำดับ</th><th>ชื่อ - นามสกุล</th><th>เวลาเริ่มสอบ</th><th>เวลาส่งข้อสอบ</th><th>เวลาที่ใช้</th>
                <th className="num">คะแนน</th><th className="num">เต็ม</th><th className="num">%</th>
                <th className="num">ถูก</th><th className="num">ผิด</th><th className="num">ไม่ตอบ</th>
                {hasPass && <th>ผลผ่าน</th>}
                <th>สถานะการส่ง</th>
                <th className="no-print">รายละเอียด</th>
                {canRetake && <th className="no-print"></th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const done = r.status !== "in_progress";
                return (
                  <tr key={r.participantId}>
                    <td>{r.no}</td>
                    <td>
                      <Link href={`/admin/results/${s.id}/${r.participantId}`}>{r.firstName} {r.lastName}</Link>
                      {r.studentCode && <div className="muted small">รหัส {r.studentCode}</div>}
                    </td>
                    <td>{formatBangkok(r.startedAt)}</td>
                    <td>{done ? formatBangkok(r.submittedAt) : "—"}</td>
                    <td>{done ? formatMinSec(r.durationSeconds) : "—"}</td>
                    <td className="num">{done ? r.score : "—"}</td>
                    <td className="num">{done ? r.maxScore : "—"}</td>
                    <td className="num">{done ? r.percent : "—"}</td>
                    <td className="num">{done ? r.correct : "—"}</td>
                    <td className="num">{done ? r.wrong : "—"}</td>
                    <td className="num">{done ? r.unanswered : "—"}</td>
                    {hasPass && (
                      <td>{r.passed === null ? "—" : <span className={`badge ${r.passed ? "ok" : "bad"}`}>{r.passed ? "ผ่าน" : "ไม่ผ่าน"}</span>}</td>
                    )}
                    <td><span className={`badge ${done ? "" : "warn"}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td className="no-print">
                      <Link className="btn small-btn" href={`/admin/results/${s.id}/${r.participantId}`}>ดูรายละเอียด</Link>
                    </td>
                    {canRetake && (
                      <td className="no-print">
                        <form>
                          <ConfirmButton
                            action={allowRetake.bind(null, s.id, r.participantId)}
                            message={`อนุญาตให้ ${r.firstName} ${r.lastName} สอบใหม่?\n\nผลสอบเดิมจะถูกเก็บไว้แต่ไม่แสดงในรายงาน${done ? "" : " และการสอบที่กำลังทำอยู่จะถูกยกเลิก"} ผู้เรียนจะได้เวลาเต็มอีกครั้ง`}
                            className="btn small-btn"
                          >
                            อนุญาตสอบใหม่
                          </ConfirmButton>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small no-print" style={{ marginTop: ".75rem" }}>
        ผู้ที่ยังสอบอยู่แสดงสถานะ “ยังไม่ส่ง” และยังไม่มีคะแนน ต้องการเก็บเป็น PDF ให้กด Ctrl+P แล้วเลือก “บันทึกเป็น PDF”
      </p>
    </>
  );
}
