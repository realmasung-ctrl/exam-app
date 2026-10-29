"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieName, examCookieOptions } from "@/lib/exam";
import { startAttemptFor } from "@/lib/exam-start";

export async function startExam(code: string, formData: FormData) {
  const r = await startAttemptFor(
    code, formData.get("first_name"), formData.get("last_name"), formData.get("student_code"),
  );
  if (!r.ok) redirect(`/e/${code}?err=${encodeURIComponent(r.code)}`);

  (await cookies()).set(cookieName(code), r.token, examCookieOptions());
  redirect(`/e/${code}/take`);
}
