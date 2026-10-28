"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { serviceClient } from "@/lib/supabase/admin";
import { isUuid, parseText, parseDuration, parseSessionForm } from "@/lib/validation";

const ERR: Record<string, string> = {
  SESSION_NOT_FOUND: "ไม่พบรอบสอบ",
  SESSION_NOT_DRAFT: "รอบสอบนี้เปิดไปแล้ว ไม่สามารถเปิดซ้ำได้",
  SESSION_NOT_OPEN: "รอบสอบนี้ไม่ได้อยู่ในสถานะที่ทำรายการนี้ได้",
  SET_NOT_FOUND: "ไม่พบชุดข้อสอบของรอบสอบนี้ (อาจถูกลบไปแล้ว)",
  INVALID_SET: "ชุดข้อสอบยังไม่ครบถ้วน ต้องแก้ให้ครบก่อนจึงเปิดรอบสอบได้",
};

function dbMsg(e: { message?: string } | null): string {
  return ERR[e?.message ?? ""] ?? "ดำเนินการไม่สำเร็จ กรุณาลองใหม่";
}
function back(id: string, kind: "ok" | "err", msg: string): never {
  redirect(`/admin/sessions/${id}?${kind}=${encodeURIComponent(msg)}`);
}
function backToList(kind: "ok" | "err", msg: string): never {
  redirect(`/admin/sessions?${kind}=${encodeURIComponent(msg)}`);
}

export async function createSession(formData: FormData) {
  const { profile } = await requireAdmin();
  const setId = formData.get("set_id");
  if (!isUuid(setId)) backToList("err", "กรุณาเลือกชุดข้อสอบ");
  const title = parseText(formData.get("title"), 200, "ชื่อรอบสอบ", true);
  if (!title.ok) backToList("err", title.error);
  const duration = parseDuration(formData.get("duration_minutes"));
  if (!duration.ok) backToList("err", duration.error);

  const db = serviceClient();
  const { data: set } = await db.from("question_sets")
    .select("id, default_reveal_mode").eq("id", setId).maybeSingle();
  if (!set) backToList("err", "ไม่พบชุดข้อสอบที่เลือก");

  const { data, error } = await db.from("exam_sessions").insert({
    set_id: setId,
    title: title.value,
    duration_minutes: duration.value,
    reveal_mode: set.default_reveal_mode,
    created_by: profile.id,
  }).select("id").single();
  if (error || !data) backToList("err", "สร้างรอบสอบไม่สำเร็จ");
  back(data.id, "ok", "สร้างรอบสอบแล้ว ตรวจสอบการตั้งค่า แล้วกด “บันทึกและเปิดรอบสอบ”");
}

export async function updateSession(id: string, formData: FormData) {
  await requireAdmin();
  if (!isUuid(id)) backToList("err", "ไม่พบรอบสอบ");

  const db = serviceClient();
  const { data: s } = await db.from("exam_sessions").select("status, opens_at").eq("id", id).maybeSingle();
  if (!s) backToList("err", "ไม่พบรอบสอบ");
  if (!["draft", "open", "running"].includes(s.status)) back(id, "err", "รอบสอบสิ้นสุดแล้ว แก้ไขไม่ได้");

  const parsed = parseSessionForm((k) => formData.get(k), s.status === "draft");
  if (!parsed.ok) back(id, "err", parsed.error);

  const closes = parsed.value.closes_at;
  if (s.status !== "draft" && typeof closes === "string" && s.opens_at && closes <= new Date(s.opens_at).toISOString()) {
    back(id, "err", "เวลาปิดรับผู้เข้าสอบต้องอยู่หลังเวลาเริ่มเปิดรับ");
  }

  const { error } = await db.from("exam_sessions").update(parsed.value).eq("id", id);
  if (error) back(id, "err", "บันทึกการตั้งค่าไม่สำเร็จ");
  back(id, "ok", "บันทึกการตั้งค่ารอบสอบแล้ว");
}

// Saves the form first (so nothing typed is lost) and then opens the session.
export async function openSession(id: string, formData: FormData) {
  await requireAdmin();
  if (!isUuid(id)) backToList("err", "ไม่พบรอบสอบ");

  const db = serviceClient();
  const { data: s } = await db.from("exam_sessions").select("status").eq("id", id).maybeSingle();
  if (!s) backToList("err", "ไม่พบรอบสอบ");
  if (s.status !== "draft") back(id, "err", ERR.SESSION_NOT_DRAFT);

  const parsed = parseSessionForm((k) => formData.get(k), true);
  if (!parsed.ok) back(id, "err", parsed.error);
  const { error: uErr } = await db.from("exam_sessions").update(parsed.value).eq("id", id).eq("status", "draft");
  if (uErr) back(id, "err", "บันทึกการตั้งค่าไม่สำเร็จ");

  const { error } = await db.rpc("open_session", { p_session_id: id });
  if (error) back(id, "err", dbMsg(error));
  back(id, "ok", "เปิดรอบสอบแล้ว แชร์ลิงก์หรือ QR Code ให้ผู้เรียนได้เลย");
}

export async function deleteSession(id: string, _formData: FormData) {
  await requireAdmin();
  if (!isUuid(id)) backToList("err", "ไม่พบรอบสอบ");
  const { data, error } = await serviceClient().from("exam_sessions")
    .delete().eq("id", id).eq("status", "draft").select("id");
  if (error || !data || data.length === 0) back(id, "err", "ลบได้เฉพาะรอบสอบที่ยังเป็นฉบับร่าง");
  backToList("ok", "ลบรอบสอบฉบับร่างแล้ว");
}

export async function closeEntry(id: string, _formData: FormData) {
  await requireAdmin();
  if (!isUuid(id)) backToList("err", "ไม่พบรอบสอบ");
  const { error } = await serviceClient().rpc("close_entry", { p_session_id: id });
  if (error) back(id, "err", dbMsg(error));
  back(id, "ok", "ปิดรับผู้เข้าสอบแล้ว ผู้ที่กำลังสอบอยู่ทำต่อได้ แต่คนใหม่เริ่มสอบไม่ได้");
}

export async function reopenEntry(id: string, _formData: FormData) {
  await requireAdmin();
  if (!isUuid(id)) backToList("err", "ไม่พบรอบสอบ");
  const { data, error } = await serviceClient().from("exam_sessions")
    .update({ entry_closed_at: null }).eq("id", id).in("status", ["open", "running"]).select("id");
  if (error || !data || data.length === 0) back(id, "err", ERR.SESSION_NOT_OPEN);
  back(id, "ok", "เปิดรับผู้เข้าสอบอีกครั้งแล้ว (ถ้าตั้งเวลาปิดรับไว้และเลยเวลาแล้ว ให้แก้เวลาปิดรับด้วย)");
}

export async function endSession(id: string, finalStatus: "ended" | "disabled", _formData: FormData) {
  await requireAdmin();
  if (!isUuid(id)) backToList("err", "ไม่พบรอบสอบ");
  const { data, error } = await serviceClient().rpc("end_session", {
    p_session_id: id, p_final_status: finalStatus,
  });
  if (error) back(id, "err", dbMsg(error));
  const n = typeof data === "number" ? data : 0;
  back(id, "ok", `${finalStatus === "ended" ? "สิ้นสุดรอบสอบแล้ว" : "ปิดใช้งานรอบสอบแล้ว"} — ตรวจและส่งคำตอบล่าสุดให้ผู้ที่กำลังสอบ ${n} คน`);
}
