// Pure helpers for the "ตรวจสอบระบบ" page (no imports -> unit-testable with node --test).

export type CheckStatus = "ok" | "warn" | "fail";
export type CheckResult = { id: string; label: string; status: CheckStatus; detail: string };

/** Hosts near Thailand (Vercel region ids): Singapore, Hong Kong, Mumbai, Tokyo, Seoul, Sydney. */
const NEAR = new Set(["sin1", "hkg1", "bom1", "hnd1", "icn1", "syd1"]);

export function evaluateRegion(region: string | undefined): CheckResult {
  const id = "region";
  const label = "ตำแหน่งเซิร์ฟเวอร์ Vercel";
  if (!region) return { id, label, status: "warn", detail: "ไม่ทราบตำแหน่ง (อาจรันในเครื่องตัวเอง)" };
  if (region === "sin1") return { id, label, status: "ok", detail: "Singapore (sin1) — ใกล้ไทยและใกล้ฐานข้อมูล" };
  if (NEAR.has(region)) return { id, label, status: "ok", detail: `${region} — อยู่ในเอเชีย-แปซิฟิก` };
  return {
    id, label, status: "warn",
    detail: `${region} อยู่ไกลจากไทยและฐานข้อมูล ทำให้ช้า — ตั้ง Settings > Functions > Function Region เป็น Singapore (sin1) แล้ว Redeploy`,
  };
}

export function evaluateLatency(ms: number): CheckResult {
  const id = "latency";
  const label = "ความเร็วติดต่อฐานข้อมูล";
  const rounded = Math.round(ms);
  if (ms < 200) return { id, label, status: "ok", detail: `${rounded} ms` };
  if (ms < 600) return { id, label, status: "warn", detail: `${rounded} ms (ค่อนข้างช้า) — ตรวจ Function Region ของ Vercel` };
  return { id, label, status: "fail", detail: `${rounded} ms (ช้ามาก) — ตรวจ Function Region และสถานะโปรเจกต์ Supabase` };
}

/** Compares the configured public address with the address this very page was opened on. */
export function evaluateAppUrl(envUrl: string | undefined, requestHost: string | null): CheckResult {
  const id = "app-url";
  const label = "ที่อยู่เว็บสำหรับลิงก์และ QR Code";
  const env = (envUrl ?? "").trim().replace(/\/+$/, "");
  if (env === "") return { id, label, status: "warn", detail: "ยังไม่ได้ตั้ง NEXT_PUBLIC_APP_URL (ระบบจะใช้ที่อยู่ของหน้านี้แทน)" };
  if (!/^https:\/\/[^\s/]+$/.test(env)) {
    return { id, label, status: "fail", detail: `ค่า "${env}" ไม่ถูกต้อง ต้องขึ้นต้นด้วย https:// และไม่มี / ท้าย` };
  }
  const host = env.replace(/^https:\/\//, "");
  if (requestHost && host.toLowerCase() !== requestHost.toLowerCase()) {
    return { id, label, status: "warn", detail: `ตั้งไว้เป็น ${host} แต่หน้านี้เปิดจาก ${requestHost} — QR Code จะชี้ไปที่ ${host} ตรวจว่าถูกต้อง` };
  }
  return { id, label, status: "ok", detail: host };
}

/** GoTrue's public /auth/v1/settings returns { disable_signup: boolean, ... }. */
export function parseAuthSettings(json: unknown): boolean | null {
  if (typeof json !== "object" || json === null) return null;
  const v = (json as { disable_signup?: unknown }).disable_signup;
  return typeof v === "boolean" ? v : null;
}

export function evaluateSignup(disableSignup: boolean | null): CheckResult {
  const id = "signup";
  const label = "ปิดการสมัครผู้ใช้สาธารณะ (Supabase)";
  if (disableSignup === true) return { id, label, status: "ok", detail: "ปิดอยู่" };
  if (disableSignup === false) {
    return { id, label, status: "fail", detail: "ยังเปิดอยู่ — ปิดที่ Supabase > Authentication > Sign In / Providers > ปิด Allow new users to sign up" };
  }
  return { id, label, status: "warn", detail: "ตรวจสอบอัตโนมัติไม่ได้ ให้เปิดดูใน Supabase > Authentication > Sign In / Providers ด้วยตนเอง" };
}

export function evaluateCronSecret(isSet: boolean): CheckResult {
  return {
    id: "cron-secret", label: "ตัวป้องกันงานปลุกระบบรายวัน (CRON_SECRET)",
    status: isSet ? "ok" : "warn",
    detail: isSet ? "ตั้งค่าแล้ว" : "ยังไม่ได้ตั้ง CRON_SECRET ใน Vercel (แนะนำให้ตั้ง)",
  };
}

export function summarize(results: CheckResult[]): { fail: number; warn: number; ok: number } {
  return {
    fail: results.filter((r) => r.status === "fail").length,
    warn: results.filter((r) => r.status === "warn").length,
    ok: results.filter((r) => r.status === "ok").length,
  };
}
