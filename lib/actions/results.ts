"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { serviceClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/validation";

function back(sessionId: string, kind: "ok" | "err", msg: string): never {
  redirect(`/admin/results/${sessionId}?${kind}=${encodeURIComponent(msg)}`);
}

// Voids the participant's attempt (kept for audit, hidden from reports) so the same person can start again.
export async function allowRetake(sessionId: string, participantId: string, _formData: FormData) {
  await requireAdmin();
  if (!isUuid(sessionId) || !isUuid(participantId)) redirect("/admin/results");

  const db = serviceClient();
  const { data: s } = await db.from("exam_sessions")
    .select("status, entry_closed_at, closes_at").eq("id", sessionId).maybeSingle();
  if (!s) redirect("/admin/results");

  // A retake only makes sense while the person is able to start again.
  if (!["open", "running"].includes(s.status)) {
    back(sessionId, "err", "รอบสอบนี้สิ้นสุดแล้ว อนุญาตสอบใหม่ไม่ได้ ให้สร้างรอบสอบใหม่แทน");
  }
  if (s.entry_closed_at !== null) {
    back(sessionId, "err", "รอบสอบปิดรับผู้เข้าสอบอยู่ ให้กด “เปิดรับผู้เข้าสอบอีกครั้ง” ที่หน้ารอบสอบก่อน แล้วค่อยอนุญาตสอบใหม่");
  }
  if (s.closes_at !== null && Date.now() >= new Date(s.closes_at).getTime()) {
    back(sessionId, "err", "เลยเวลาปิดรับผู้เข้าสอบแล้ว ให้แก้เวลาปิดรับที่หน้ารอบสอบก่อน");
  }

  const { data: p } = await db.from("exam_participants")
    .select("id, first_name, last_name").eq("id", participantId).eq("session_id", sessionId).is("voided_at", null).maybeSingle();
  if (!p) back(sessionId, "err", "ไม่พบผู้เข้าสอบรายนี้");

  const { error } = await db.rpc("allow_retake", { p_participant_id: participantId });
  if (error) back(sessionId, "err", "อนุญาตสอบใหม่ไม่สำเร็จ");
  back(sessionId, "ok",
    `อนุญาตให้ ${p.first_name} ${p.last_name} สอบใหม่แล้ว — ผลเดิมถูกเก็บไว้แต่ไม่แสดงในรายงาน ให้ผู้เรียนเปิดลิงก์เดิมแล้วกรอกชื่อเพื่อเริ่มใหม่ (ได้เวลาเต็มอีกครั้ง)`);
}
