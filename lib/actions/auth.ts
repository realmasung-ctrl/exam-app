"use server";
import { redirect } from "next/navigation";
import { sessionClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/admin";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) redirect("/admin/login?error=missing");

  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) redirect("/admin/login?error=invalid");

  const { data: profile } = await serviceClient()
    .from("admin_profiles").select("id").eq("id", data.user.id).maybeSingle();
  if (!profile) {
    await supabase.auth.signOut();
    redirect("/admin/login?error=forbidden");
  }
  redirect("/admin");
}

export async function logout() {
  const supabase = await sessionClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
