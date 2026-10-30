"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { serviceClient } from "@/lib/supabase/admin";
import { isUuid, parseText } from "@/lib/validation";
import { parseSaveInput } from "@/lib/set-content";

function back(setId: string, kind: "ok" | "err", msg: string): never {
  redirect(`/admin/sets/${setId}?${kind}=${encodeURIComponent(msg)}`);
}
function backToList(kind: "ok" | "err", msg: string): never {
  redirect(`/admin/sets?${kind}=${encodeURIComponent(msg)}`);
}

export async function createSet(formData: FormData) {
  const { profile } = await requireAdmin();
  const title = parseText(formData.get("title"), 200, "ชื่อชุดข้อสอบ", true);
  if (!title.ok) backToList("err", title.error);

  const { data, error } = await serviceClient()
    .from("question_sets").insert({ title: title.value, created_by: profile.id }).select("id").single();
  if (error || !data) backToList("err", "สร้างชุดข้อสอบไม่สำเร็จ");
  back(data.id, "ok", "สร้างชุดข้อสอบแล้ว เริ่มเพิ่มคำถามได้เลย");
}

export async function deleteSet(setId: string, _formData: FormData) {
  await requireAdmin();
  if (!isUuid(setId)) backToList("err", "ไม่พบชุดข้อสอบ");
  const { error } = await serviceClient().from("question_sets").delete().eq("id", setId);
  if (error) back(setId, "err", "ลบชุดข้อสอบไม่สำเร็จ");
  backToList("ok", "ลบชุดข้อสอบแล้ว (รอบสอบที่เคยเปิดไปแล้วยังคงเก็บข้อสอบและผลสอบไว้ครบ)");
}

const SAVE_ERR: Record<string, string> = {
  SET_NOT_FOUND: "ไม่พบชุดข้อสอบ (อาจถูกลบไปแล้ว)",
  TOO_MANY_QUESTIONS: "ชุดข้อสอบมีได้ไม่เกิน 500 ข้อ",
  INVALID_PAYLOAD: "ข้อมูลที่ส่งมาไม่ถูกต้อง",
  DUPLICATE_ID: "ข้อมูลที่ส่งมาซ้ำกัน กรุณารีเฟรชหน้าแล้วลองใหม่",
  FOREIGN_QUESTION: "ข้อมูลที่ส่งมาไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่",
};

export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string };

/** Saves the whole one-page editor (settings + every question) in ONE database call.
 *  Called from the browser (no page reload); returns a result instead of redirecting. */
export async function saveSetContent(setId: string, raw: unknown): Promise<SaveResult> {
  await requireAdmin();
  if (!isUuid(setId)) return { ok: false, error: "ไม่พบชุดข้อสอบ" };

  const parsed = parseSaveInput(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { error } = await serviceClient().rpc("save_set_content", {
    p_set_id: setId,
    p_settings: parsed.value.settings,
    p_questions: parsed.value.questions,
  });
  if (error) return { ok: false, error: SAVE_ERR[error.message] ?? "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  return { ok: true, savedAt: new Date().toISOString() };
}

export async function markReady(setId: string, _formData: FormData) {
  await requireAdmin();
  if (!isUuid(setId)) backToList("err", "ไม่พบชุดข้อสอบ");
  const db = serviceClient();
  const { data: problems } = await db.rpc("validate_question_set", { p_set_id: setId });
  if (problems && problems.length > 0) back(setId, "err", "ชุดข้อสอบยังไม่ครบถ้วน ดูรายการที่ต้องแก้ด้านบน");
  await db.from("question_sets").update({ status: "ready" }).eq("id", setId);
  back(setId, "ok", "ทำเครื่องหมายว่าพร้อมใช้งานแล้ว");
}
