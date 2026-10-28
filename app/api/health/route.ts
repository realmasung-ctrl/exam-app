import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/admin";

// Called daily by Vercel Cron (see vercel.json) so the free Supabase project
// does not get paused for inactivity. Also sweeps expired attempts.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const { data, error } = await serviceClient().rpc("finalize_expired");
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true, finalized: data });
}
