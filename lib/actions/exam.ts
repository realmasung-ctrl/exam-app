"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { serviceClient } from "@/lib/supabase/admin";
import { newExamToken, hashToken } from "@/lib/token";
import { CODE_RE, cookieName } from "@/lib/exam";
import { parseText } from "@/lib/validation";

function backWith(code: string, err: string): never {
  redirect(`/e/${code}?err=${encodeURIComponent(err)}`);
}

export async function startExam(code: string, formData: FormData) {
  if (!CODE_RE.test(code)) redirect("/");

  const first = parseText(formData.get("first_name"), 100, "ชื่อ", true);
  const last = parseText(formData.get("last_name"), 100, "นามสกุล", true);
  if (!first.ok || !last.ok) backWith(code, "NAME_REQUIRED");
  const sc = parseText(formData.get("student_code"), 50, "รหัสประจำตัว");
  if (!sc.ok) backWith(code, "CODE_INVALID");

  const token = newExamToken();
  const { error } = await serviceClient().rpc("start_attempt", {
    p_code: code,
    p_first_name: first.value,
    p_last_name: last.value,
    p_student_code: sc.value === "" ? null : sc.value,
    p_token_hash: hashToken(token),
  });
  if (error) backWith(code, error.message);

  (await cookies()).set(cookieName(code), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  redirect(`/e/${code}/take`);
}
