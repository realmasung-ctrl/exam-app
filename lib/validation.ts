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
