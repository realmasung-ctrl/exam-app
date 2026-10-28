import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/admin";
import { NO_STORE, sameOrigin, tokenHash } from "@/lib/exam";

export const dynamic = "force-dynamic";

const json = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

// Idempotent: submitting twice (double click, retry after a network drop) returns the same result.
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!sameOrigin(req)) return json({ code: "FORBIDDEN" }, 403);
  const { code } = await params;
  const hash = await tokenHash(code);
  if (!hash) return json({ code: "INVALID_TOKEN" }, 401);

  const { data, error } = await serviceClient().rpc("submit_attempt", { p_token_hash: hash });
  if (error) {
    return error.message === "INVALID_TOKEN" ? json({ code: "INVALID_TOKEN" }, 401) : json({ code: "SERVER" }, 500);
  }
  const r = data as { status?: string };
  return json({ ok: true, status: r.status ?? null });
}
