"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { serviceClient } from "@/lib/supabase/admin";
import {
  LABELS, isUuid, parseText, parsePoints, parseScoringMode, parseRevealMode, parseQuestionForm,
} from "@/lib/validation";

const MAX_QUESTIONS = 500;

function back(setId: string, kind: "ok" | "err", msg: string, anchor?: string): never {
  redirect(`/admin/sets/${setId}?${kind}=${encodeURIComponent(msg)}${anchor ? `#${anchor}` : ""}`);
}
function backToList(kind: "ok" | "err", msg: string): never {
  redirect(`/admin/sets?${kind}=${encodeURIComponent(msg)}`);
}

// Any edit makes a "ready" set a draft again until it is re-validated.
async function markDraft(setId: string) {
  await serviceClient().from("question_sets").update({ status: "draft" }).eq("id", setId);
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

export async function updateSet(setId: string, formData: FormData) {
  await requireAdmin();
  if (!isUuid(setId)) backToList("err", "ไม่พบชุดข้อสอบ");

  const title = parseText(formData.get("title"), 200, "ชื่อชุดข้อสอบ", true);
  if (!title.ok) back(setId, "err", title.error);
  const instructions = parseText(formData.get("instructions"), 5000, "คำชี้แจง");
  if (!instructions.ok) back(setId, "err", instructions.error);
  const mode = parseScoringMode(formData.get("scoring_mode"));
  if (!mode.ok) back(setId, "err", mode.error);
  const reveal = parseRevealMode(formData.get("default_reveal_mode"));
  if (!reveal.ok) back(setId, "err", reveal.error);

  const patch: Record<string, unknown> = {
    title: title.value, instructions: instructions.value,
    scoring_mode: mode.value, default_reveal_mode: reveal.value, status: "draft",
  };
  if (mode.value === "equal") {
    const pts = parsePoints(formData.get("equal_points"));
    if (!pts.ok) back(setId, "err", pts.error);
    patch.equal_points = pts.value;
  }

  const { error } = await serviceClient().from("question_sets").update(patch).eq("id", setId);
  if (error) back(setId, "err", "บันทึกการตั้งค่าไม่สำเร็จ");
  back(setId, "ok", "บันทึกการตั้งค่าชุดข้อสอบแล้ว");
}

export async function deleteSet(setId: string, _formData: FormData) {
  await requireAdmin();
  if (!isUuid(setId)) backToList("err", "ไม่พบชุดข้อสอบ");
  const { error } = await serviceClient().from("question_sets").delete().eq("id", setId);
  if (error) back(setId, "err", "ลบชุดข้อสอบไม่สำเร็จ");
  backToList("ok", "ลบชุดข้อสอบแล้ว (รอบสอบที่เคยเปิดไปแล้วยังคงเก็บข้อสอบและผลสอบไว้ครบ)");
}

export async function addQuestion(setId: string, _formData: FormData) {
  await requireAdmin();
  if (!isUuid(setId)) backToList("err", "ไม่พบชุดข้อสอบ");
  const db = serviceClient();

  const { data: last } = await db.from("questions").select("position")
    .eq("set_id", setId).order("position", { ascending: false }).limit(1);
  const { count } = await db.from("questions").select("id", { count: "exact", head: true }).eq("set_id", setId);
  if ((count ?? 0) >= MAX_QUESTIONS) back(setId, "err", `ชุดข้อสอบมีได้ไม่เกิน ${MAX_QUESTIONS} ข้อ`);

  const position = ((last && last[0]?.position) ?? 0) + 1;
  const { data: q, error } = await db.from("questions")
    .insert({ set_id: setId, position }).select("id").single();
  if (error || !q) back(setId, "err", "เพิ่มคำถามไม่สำเร็จ");

  const { error: cErr } = await db.from("answer_choices")
    .insert(LABELS.map((label) => ({ question_id: q.id, label })));
  if (cErr) {
    await db.from("questions").delete().eq("id", q.id);
    back(setId, "err", "เพิ่มคำถามไม่สำเร็จ");
  }
  await markDraft(setId);
  back(setId, "ok", `เพิ่มข้อ ${position} แล้ว`, `q-${q.id}`);
}

// Shared by save + move so unsaved edits in the card are never lost.
async function persistQuestion(setId: string, qid: string, fd: FormData): Promise<string | null> {
  const db = serviceClient();
  const { data: set } = await db.from("question_sets").select("scoring_mode").eq("id", setId).maybeSingle();
  if (!set) return "ไม่พบชุดข้อสอบ";

  const parsed = parseQuestionForm((k) => fd.get(k), set.scoring_mode);
  if (!parsed.ok) return parsed.error;
  const v = parsed.value;

  const patch: Record<string, unknown> = { body: v.body, explanation: v.explanation };
  if (v.points !== null) patch.points = v.points;
  const { data: upd, error } = await db.from("questions").update(patch)
    .eq("id", qid).eq("set_id", setId).select("id");
  if (error || !upd || upd.length === 0) return "บันทึกคำถามไม่สำเร็จ";

  // upsert (not update) so a question that somehow lacks a choice row heals itself;
  // is_correct is deliberately not in the payload.
  const rows = LABELS.map((label, i) => ({ question_id: qid, label, body: v.choices[i] }));
  const { error: cErr } = await db.from("answer_choices").upsert(rows, { onConflict: "question_id,label" });
  if (cErr) return "บันทึกตัวเลือกไม่สำเร็จ";

  if (v.correct) {
    const { error: rErr } = await db.rpc("set_correct_choice", { p_question_id: qid, p_label: v.correct });
    if (rErr) return "บันทึกเฉลยไม่สำเร็จ";
  }
  await markDraft(setId);
  return null;
}

export async function saveQuestion(setId: string, qid: string, formData: FormData) {
  await requireAdmin();
  if (!isUuid(setId) || !isUuid(qid)) backToList("err", "ไม่พบข้อมูล");
  const err = await persistQuestion(setId, qid, formData);
  if (err) back(setId, "err", err, `q-${qid}`);
  back(setId, "ok", "บันทึกคำถามแล้ว", `q-${qid}`);
}

export async function deleteQuestion(setId: string, qid: string, _formData: FormData) {
  await requireAdmin();
  if (!isUuid(setId) || !isUuid(qid)) backToList("err", "ไม่พบข้อมูล");
  const db = serviceClient();
  const { error } = await db.from("questions").delete().eq("id", qid).eq("set_id", setId);
  if (error) back(setId, "err", "ลบคำถามไม่สำเร็จ");

  // close the gap so stored positions always equal 1..n (the editor and validation rely on it)
  const { data } = await db.from("questions").select("id").eq("set_id", setId).order("position");
  const ids: string[] = (data ?? []).map((r: { id: string }) => r.id);
  if (ids.length > 0) await db.rpc("reorder_questions", { p_set_id: setId, p_ordered_ids: ids });

  await markDraft(setId);
  back(setId, "ok", "ลบคำถามแล้ว");
}

export async function moveQuestion(setId: string, qid: string, dir: "up" | "down", formData: FormData) {
  await requireAdmin();
  if (!isUuid(setId) || !isUuid(qid)) backToList("err", "ไม่พบข้อมูล");

  const err = await persistQuestion(setId, qid, formData);
  if (err) back(setId, "err", err, `q-${qid}`);

  const db = serviceClient();
  const { data } = await db.from("questions").select("id").eq("set_id", setId).order("position");
  const ids: string[] = (data ?? []).map((r: { id: string }) => r.id);
  const i = ids.indexOf(qid);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) back(setId, "ok", "บันทึกแล้ว", `q-${qid}`);

  [ids[i], ids[j]] = [ids[j], ids[i]];
  const { error } = await db.rpc("reorder_questions", { p_set_id: setId, p_ordered_ids: ids });
  if (error) back(setId, "err", "เปลี่ยนลำดับไม่สำเร็จ", `q-${qid}`);
  back(setId, "ok", "เปลี่ยนลำดับแล้ว", `q-${qid}`);
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
