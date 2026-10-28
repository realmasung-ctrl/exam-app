"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { sessionClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/admin";
import { parseEmail, parsePassword, parseText } from "@/lib/validation";

function back(kind: "ok" | "err", msg: string): never {
  redirect(`/admin/settings?${kind}=${encodeURIComponent(msg)}`);
}

export async function createAdmin(formData: FormData) {
  await requireAdmin();
  const email = parseEmail(formData.get("email"));
  if (!email.ok) back("err", email.error);
  const name = parseText(formData.get("display_name"), 100, "ชื่อที่แสดง", true);
  if (!name.ok) back("err", name.error);
  const password = parsePassword(formData.get("password"));
  if (!password.ok) back("err", password.error);

  const db = serviceClient();
  const { data, error } = await db.auth.admin.createUser({
    email: email.value, password: password.value, email_confirm: true,
  });
  if (error || !data.user) {
    back("err", /already/i.test(error?.message ?? "") ? "อีเมลนี้มีบัญชีอยู่แล้ว" : "สร้างบัญชีไม่สำเร็จ");
  }

  const { error: pErr } = await db.from("admin_profiles").insert({ id: data.user.id, display_name: name.value });
  if (pErr) {
    await db.auth.admin.deleteUser(data.user.id); // do not leave a login without admin profile
    back("err", "สร้างโปรไฟล์ผู้ดูแลไม่สำเร็จ");
  }
  back("ok", `สร้างบัญชีผู้ดูแล ${email.value} แล้ว — แจ้งรหัสผ่านให้เจ้าตัวและให้เปลี่ยนรหัสหลังเข้าสู่ระบบ`);
}

export async function changeMyPassword(formData: FormData) {
  await requireAdmin();
  const password = parsePassword(formData.get("password"));
  if (!password.ok) back("err", password.error);
  if (formData.get("password") !== formData.get("confirm")) back("err", "รหัสผ่านทั้งสองช่องไม่ตรงกัน");

  const supabase = await sessionClient();
  const { error } = await supabase.auth.updateUser({ password: password.value });
  if (error) back("err", "เปลี่ยนรหัสผ่านไม่สำเร็จ");
  back("ok", "เปลี่ยนรหัสผ่านแล้ว");
}
