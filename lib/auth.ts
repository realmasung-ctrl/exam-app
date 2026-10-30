import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { sessionClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/admin";

/** Call at the top of every admin page and every admin server action.
 *  A Supabase login alone is NOT enough: the user must have an admin_profiles row. */
async function checkAdmin() {
  const supabase = await sessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data: profile } = await serviceClient()
    .from("admin_profiles")
    .select("id, display_name")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) redirect("/admin/login?error=forbidden");

  return { user, profile: profile as { id: string; display_name: string } };
}

/** Call at the top of every admin page and every admin server action.
 *  Memoised per request (React cache): the layout and the page share ONE check instead of two network round trips. */
export const requireAdmin = cache(checkAdmin);

/** For route handlers (CSV/Excel export): returns null instead of redirecting, so the caller can answer 401. */
export async function getAdminOrNull() {
  const supabase = await sessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await serviceClient()
    .from("admin_profiles").select("id, display_name").eq("id", user.id).maybeSingle();
  return profile ? (profile as { id: string; display_name: string }) : null;
}
