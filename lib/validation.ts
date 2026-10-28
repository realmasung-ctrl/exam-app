// Pure input validation (no imports) so it can be unit-tested with `node --test`.

export const LABELS = ["ก", "ข", "ค", "ง"] as const;
export type Label = (typeof LABELS)[number];
export type ScoringMode = "equal" | "custom";
export type RevealMode = "immediate" | "after_close" | "hidden";
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function parseText(v: unknown, max: number, name: string, required = false): Result<string> {
  const s = typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : "";
  if (required && s === "") return fail(`กรุณากรอก${name}`);
  if (s.length > max) return fail(`${name}ยาวเกิน ${max} ตัวอักษร`);
  return ok(s);
}

export function parsePoints(v: unknown): Result<number> {
  const s = typeof v === "string" ? v.trim() : "";
  const n = Number(s);
  if (s === "" || !Number.isFinite(n) || n <= 0 || n > 1000) {
    return fail("คะแนนต้องเป็นตัวเลขมากกว่า 0 และไม่เกิน 1000");
  }
  return ok(Math.round(n * 100) / 100);
}

export function parseLabel(v: unknown): Label | null {
  return typeof v === "string" && (LABELS as readonly string[]).includes(v) ? (v as Label) : null;
}

export function parseScoringMode(v: unknown): Result<ScoringMode> {
  return v === "equal" || v === "custom" ? ok(v) : fail("วิธีคิดคะแนนไม่ถูกต้อง");
}

export function parseRevealMode(v: unknown): Result<RevealMode> {
  return v === "immediate" || v === "after_close" || v === "hidden" ? ok(v) : fail("โหมดการแสดงเฉลยไม่ถูกต้อง");
}

export function parseEmail(v: unknown): Result<string> {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return fail("รูปแบบอีเมลไม่ถูกต้อง");
  return ok(s);
}

export function parsePassword(v: unknown): Result<string> {
  const s = typeof v === "string" ? v : "";
  if (s.length < 10) return fail("รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร");
  if (s.length > 72) return fail("รหัสผ่านยาวเกิน 72 ตัวอักษร");
  return ok(s);
}

export type QuestionInput = {
  body: string;
  explanation: string | null;
  points: number | null; // null = keep existing (equal-points mode)
  choices: [string, string, string, string];
  correct: Label | null;
};

/** Drafts may be incomplete, so only lengths/number formats are enforced here;
 *  completeness is checked by validate_question_set() before a session opens. */
export function parseQuestionForm(
  get: (name: string) => unknown,
  scoringMode: ScoringMode,
): Result<QuestionInput> {
  const body = parseText(get("body"), 2000, "คำถาม");
  if (!body.ok) return body;
  const explanation = parseText(get("explanation"), 2000, "คำอธิบายเฉลย");
  if (!explanation.ok) return explanation;

  const choices: string[] = [];
  for (let i = 0; i < 4; i++) {
    const c = parseText(get(`c${i}`), 500, `ตัวเลือก ${LABELS[i]}`);
    if (!c.ok) return c;
    choices.push(c.value);
  }

  let points: number | null = null;
  if (scoringMode === "custom") {
    const p = parsePoints(get("points"));
    if (!p.ok) return p;
    points = p.value;
  }

  return ok({
    body: body.value,
    explanation: explanation.value === "" ? null : explanation.value,
    points,
    choices: choices as [string, string, string, string],
    correct: parseLabel(get("correct")),
  });
}

// ---------------------------------------------------------------------
// Exam sessions (Phase 4)
// ---------------------------------------------------------------------

const BANGKOK_OFFSET_MS = 7 * 3600 * 1000; // Thailand has no daylight saving time

/** "2026-10-28T09:30" typed by an admin in Bangkok time -> UTC ISO string (null if invalid). */
export function bangkokLocalToIso(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) - BANGKOK_OFFSET_MS;
  const iso = new Date(ms).toISOString();
  return isoToBangkokLocal(iso) === s ? iso : null; // rejects 2026-02-31, hour 25, ...
}

/** UTC ISO string -> "YYYY-MM-DDTHH:mm" in Bangkok time (value for <input type="datetime-local">). */
export function isoToBangkokLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + BANGKOK_OFFSET_MS).toISOString().slice(0, 16);
}

export function parseDuration(v: unknown): Result<number> {
  const s = typeof v === "string" ? v.trim() : "";
  const n = Number(s);
  if (s === "" || !Number.isInteger(n) || n < 1 || n > 600) {
    return fail("เวลาสอบต้องเป็นจำนวนนาทีเต็ม ตั้งแต่ 1 ถึง 600 นาที");
  }
  return ok(n);
}

export function parseOptionalPercent(v: unknown): Result<number | null> {
  const s = typeof v === "string" ? v.trim() : "";
  if (s === "") return ok(null);
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return fail("เปอร์เซ็นต์คะแนนผ่านต้องอยู่ระหว่าง 0 ถึง 100");
  return ok(Math.round(n * 100) / 100);
}

export function parseOptionalCount(v: unknown, name: string, max = 10000): Result<number | null> {
  const s = typeof v === "string" ? v.trim() : "";
  if (s === "") return ok(null);
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > max) return fail(`${name}ต้องเป็นจำนวนเต็ม 0 ถึง ${max}`);
  return ok(n);
}

export function parseOptionalDateTime(v: unknown, name: string): Result<string | null> {
  const s = typeof v === "string" ? v.trim() : "";
  if (s === "") return ok(null);
  const iso = bangkokLocalToIso(s);
  return iso ? ok(iso) : fail(`${name}ไม่ถูกต้อง`);
}

/** draft = true: every field is editable. draft = false (session already opened):
 *  only title / reveal mode / entry-close time / expected count may change, because the rest
 *  would make already-started attempts inconsistent. */
export function parseSessionForm(get: (name: string) => unknown, draft: boolean): Result<Record<string, unknown>> {
  const title = parseText(get("title"), 200, "ชื่อรอบสอบ", true);
  if (!title.ok) return title;
  const reveal = parseRevealMode(get("reveal_mode"));
  if (!reveal.ok) return reveal;
  const closes = parseOptionalDateTime(get("closes_at"), "เวลาปิดรับผู้เข้าสอบ");
  if (!closes.ok) return closes;
  const expected = parseOptionalCount(get("expected_participants"), "จำนวนผู้เข้าสอบที่คาดไว้");
  if (!expected.ok) return expected;

  const patch: Record<string, unknown> = {
    title: title.value,
    reveal_mode: reveal.value,
    closes_at: closes.value,
    expected_participants: expected.value,
  };

  if (draft) {
    const setId = get("set_id");
    if (!isUuid(setId)) return fail("กรุณาเลือกชุดข้อสอบ");
    const duration = parseDuration(get("duration_minutes"));
    if (!duration.ok) return duration;
    const opens = parseOptionalDateTime(get("opens_at"), "เวลาเริ่มเปิดรับผู้เข้าสอบ");
    if (!opens.ok) return opens;
    const pass = parseOptionalPercent(get("pass_percent"));
    if (!pass.ok) return pass;
    if (opens.value && closes.value && closes.value <= opens.value) {
      return fail("เวลาปิดรับผู้เข้าสอบต้องอยู่หลังเวลาเริ่มเปิดรับ");
    }
    Object.assign(patch, {
      set_id: setId,
      duration_minutes: duration.value,
      opens_at: opens.value,
      pass_percent: pass.value,
      require_student_code: get("require_student_code") === "on",
    });
  }
  return ok(patch);
}
