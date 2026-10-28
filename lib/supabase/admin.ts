import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only client using the service_role key. It bypasses RLS, so it must
// only be used in route handlers / server components AFTER the caller has been
// authenticated (admin session or student exam token).
export function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
