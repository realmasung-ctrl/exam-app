import "server-only";
import { headers } from "next/headers";
import { serviceClient } from "@/lib/supabase/admin";
import {
  evaluateAppUrl, evaluateCronSecret, evaluateLatency, evaluateRegion, evaluateSignup, parseAuthSettings,
  type CheckResult,
} from "@/lib/syscheck-logic";

const ZERO = "00000000-0000-4000-8000-000000000000";
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function timed<T>(fn: () => PromiseLike<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - t0 };
}

/** Read-only health checks for the admin "ตรวจสอบระบบ" page. Never returns secrets, only yes/no and plain facts. */
export async function runSystemChecks(): Promise<CheckResult[]> {
  const db = serviceClient();
  const out: CheckResult[] = [];

  // 1) database reachable + how fast
  try {
    const { value, ms } = await timed(() => db.from("admin_profiles").select("id", { count: "exact", head: true }));
    if (value.error) {
      out.push({ id: "db", label: "เชื่อมต่อฐานข้อมูล", status: "fail", detail: `เชื่อมต่อไม่ได้: ${value.error.message}` });
    } else {
      out.push({ id: "db", label: "เชื่อมต่อฐานข้อมูล", status: "ok", detail: `ผู้ดูแลในระบบ ${value.count ?? 0} คน` });
      out.push(evaluateLatency(ms));
    }
  } catch (e) {
    out.push({ id: "db", label: "เชื่อมต่อฐานข้อมูล", status: "fail", detail: `เชื่อมต่อไม่ได้: ${msg(e)}` });
  }

  // 2) migrations: calls functions that are harmless with an unknown id and only prove that they exist
  const probes: { id: string; label: string; run: () => PromiseLike<{ error: { message: string } | null }>; expect?: string; hint: string }[] = [
    { id: "m2", label: "ฟังก์ชันตรวจคะแนน/เวลา (migration 0002)", hint: "รัน 0002_functions.sql",
      run: () => db.rpc("validate_question_set", { p_set_id: ZERO }) },
    { id: "m5", label: "บันทึกชุดข้อสอบแบบรวด (migration 0005)", hint: "รัน 0005_save_set_content.sql", expect: "SET_NOT_FOUND",
      run: () => db.rpc("save_set_content", { p_set_id: ZERO, p_settings: {}, p_questions: [] }) },
  ];
  for (const p of probes) {
    try {
      const { error } = await p.run();
      const ok = p.expect ? error?.message === p.expect : error === null;
      out.push({ id: p.id, label: p.label, status: ok ? "ok" : "fail", detail: ok ? "พร้อมใช้งาน" : `ไม่พบหรือทำงานผิดปกติ — ${p.hint}${error ? ` (${error.message})` : ""}` });
    } catch (e) {
      out.push({ id: p.id, label: p.label, status: "fail", detail: msg(e) });
    }
  }

  // 3) sign-up switched off (public endpoint of Supabase Auth)
  let disable: boolean | null = null;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/settings`, { headers: { apikey: key }, signal: ctrl.signal, cache: "no-store" });
      clearTimeout(t);
      if (r.ok) disable = parseAuthSettings(await r.json());
    }
  } catch {
    disable = null;
  }
  out.push(evaluateSignup(disable));

  // 4) deployment settings
  const h = await headers();
  out.push(evaluateAppUrl(process.env.NEXT_PUBLIC_APP_URL, h.get("x-forwarded-host") ?? h.get("host")));
  out.push(evaluateRegion(process.env.VERCEL_REGION));
  out.push(evaluateCronSecret(Boolean(process.env.CRON_SECRET)));
  return out;
}
