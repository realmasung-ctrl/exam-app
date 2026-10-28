// Usage:  npm run create-admin -- you@example.com 'StrongPassword' 'ชื่อที่แสดง'
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
// Refuses to run if an admin already exists (further admins are invited from the dashboard).
import { createClient } from "@supabase/supabase-js";

const [, , email, password, displayName] = process.argv;
if (!email || !password || password.length < 10) {
  console.error("Usage: npm run create-admin -- <email> <password (min 10 chars)> [display name]");
  process.exit(1);
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { count, error: cErr } = await sb
  .from("admin_profiles")
  .select("id", { count: "exact", head: true });
if (cErr) { console.error("DB error:", cErr.message); process.exit(1); }
if (count > 0) { console.error("An admin already exists. Invite others from the dashboard."); process.exit(1); }

const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
if (error) { console.error("Create user failed:", error.message); process.exit(1); }

const { error: pErr } = await sb
  .from("admin_profiles")
  .insert({ id: data.user.id, display_name: displayName ?? email });
if (pErr) { console.error("Profile insert failed:", pErr.message); process.exit(1); }

console.log("First admin created:", email);
