// Pure logic for the one-page question-set editor (no imports -> unit-testable with node --test).

export const LABELS = ["ก", "ข", "ค", "ง"] as const;
export type Label = (typeof LABELS)[number];
export type Mode = "equal" | "custom";
export type Reveal = "immediate" | "after_close" | "hidden";
export const MAX_QUESTIONS = 500;

export type EditorQuestion = {
  id: string;
  body: string;
  explanation: string;
  points: string; // text in the form; only used when scoring is "custom"
  choices: [string, string, string, string];
  correct: Label | null;
};
export type EditorSettings = {
  title: string;
  instructions: string;
  scoring_mode: Mode;
  equal_points: string;
  default_reveal_mode: Reveal;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same rules as the database function validate_question_set(), but instant (no server round trip). */
export function problemsFor(q: EditorQuestion, mode: Mode): string[] {
  const out: string[] = [];
  if (q.body.trim() === "") out.push("ยังไม่ได้กรอกคำถาม");
  const empty = LABELS.filter((_, i) => q.choices[i].trim() === "");
  if (empty.length > 0) out.push(`ตัวเลือกยังว่าง: ${empty.join(" ")}`);
  if (q.correct === null) out.push("ยังไม่ได้เลือกเฉลย");
  if (mode === "custom") {
    const p = Number(q.points);
    if (q.points.trim() === "" || !Number.isFinite(p) || p <= 0 || p > 1000) out.push("คะแนนต้องมากกว่า 0 และไม่เกิน 1000");
  }
  return out;
}

export function totalPoints(questions: EditorQuestion[], s: Pick<EditorSettings, "scoring_mode" | "equal_points">): number {
  if (s.scoring_mode === "equal") {
    const p = Number(s.equal_points);
    return Math.round((Number.isFinite(p) && p > 0 ? p : 0) * questions.length * 100) / 100;
  }
  const sum = questions.reduce((acc, q) => {
    const p = Number(q.points);
    return acc + (Number.isFinite(p) && p > 0 ? p : 0);
  }, 0);
  return Math.round(sum * 100) / 100;
}

export function blankQuestion(id: string, points = "1"): EditorQuestion {
  return { id, body: "", explanation: "", points, choices: ["", "", "", ""], correct: null };
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export type SavePayload = {
  settings: {
    title: string; instructions: string; scoring_mode: Mode;
    equal_points: number | null; default_reveal_mode: Reveal;
  };
  questions: {
    id: string; body: string; explanation: string; points: number | null;
    choices: [string, string, string, string]; correct: Label | null;
  }[];
};

/** Validates what the browser sent. The client is never trusted: this runs on the server before the database. */
export function parseSaveInput(raw: unknown): Result<SavePayload> {
  if (typeof raw !== "object" || raw === null) return fail("ข้อมูลที่ส่งมาไม่ถูกต้อง");
  const r = raw as { settings?: unknown; questions?: unknown };
  if (typeof r.settings !== "object" || r.settings === null || !Array.isArray(r.questions)) return fail("ข้อมูลที่ส่งมาไม่ถูกต้อง");
  const s = r.settings as Record<string, unknown>;

  const title = str(s.title)?.trim() ?? "";
  if (title === "") return fail("กรุณากรอกชื่อชุดข้อสอบ");
  if (title.length > 200) return fail("ชื่อชุดข้อสอบยาวเกิน 200 ตัวอักษร");
  const instructions = str(s.instructions)?.replace(/\r\n?/g, "\n").trim() ?? "";
  if (instructions.length > 5000) return fail("คำชี้แจงยาวเกิน 5000 ตัวอักษร");
  const mode = s.scoring_mode;
  if (mode !== "equal" && mode !== "custom") return fail("วิธีคิดคะแนนไม่ถูกต้อง");
  const reveal = s.default_reveal_mode;
  if (reveal !== "immediate" && reveal !== "after_close" && reveal !== "hidden") return fail("โหมดการแสดงเฉลยไม่ถูกต้อง");

  let equalPoints: number | null = null;
  const ep = Number(str(s.equal_points) ?? "");
  if (mode === "equal") {
    if ((str(s.equal_points) ?? "").trim() === "" || !Number.isFinite(ep) || ep <= 0 || ep > 1000) {
      return fail("คะแนนต่อข้อต้องมากกว่า 0 และไม่เกิน 1000");
    }
    equalPoints = Math.round(ep * 100) / 100;
  } else if (Number.isFinite(ep) && ep > 0 && ep <= 1000) {
    equalPoints = Math.round(ep * 100) / 100;
  }

  if (r.questions.length > MAX_QUESTIONS) return fail(`ชุดข้อสอบมีได้ไม่เกิน ${MAX_QUESTIONS} ข้อ`);
  const seen = new Set<string>();
  const questions: SavePayload["questions"] = [];
  for (let i = 0; i < r.questions.length; i++) {
    const q = r.questions[i] as Record<string, unknown> | null;
    const n = i + 1;
    if (typeof q !== "object" || q === null) return fail(`ข้อ ${n}: ข้อมูลไม่ถูกต้อง`);
    const id = str(q.id);
    if (id === null || !UUID_RE.test(id)) return fail(`ข้อ ${n}: รหัสข้อไม่ถูกต้อง`);
    if (seen.has(id.toLowerCase())) return fail(`ข้อ ${n}: รหัสข้อซ้ำกัน`);
    seen.add(id.toLowerCase());

    const body = str(q.body)?.replace(/\r\n?/g, "\n").trim() ?? null;
    if (body === null || body.length > 2000) return fail(`ข้อ ${n}: คำถามยาวเกิน 2000 ตัวอักษร`);
    const explanation = str(q.explanation)?.replace(/\r\n?/g, "\n").trim() ?? "";
    if (explanation.length > 2000) return fail(`ข้อ ${n}: คำอธิบายเฉลยยาวเกิน 2000 ตัวอักษร`);

    if (!Array.isArray(q.choices) || q.choices.length !== 4) return fail(`ข้อ ${n}: ตัวเลือกต้องมี 4 ข้อ`);
    const choices: string[] = [];
    for (let c = 0; c < 4; c++) {
      const t = str(q.choices[c])?.replace(/\r\n?/g, "\n").trim() ?? null;
      if (t === null || t.length > 500) return fail(`ข้อ ${n}: ตัวเลือก ${LABELS[c]} ยาวเกิน 500 ตัวอักษร`);
      choices.push(t);
    }

    const correct = q.correct === null || q.correct === undefined || q.correct === "" ? null : (LABELS as readonly unknown[]).includes(q.correct) ? (q.correct as Label) : "bad";
    if (correct === "bad") return fail(`ข้อ ${n}: เฉลยไม่ถูกต้อง`);

    let points: number | null = null;
    if (mode === "custom") {
      const p = Number(str(q.points) ?? "");
      if ((str(q.points) ?? "").trim() === "" || !Number.isFinite(p) || p <= 0 || p > 1000) {
        return fail(`ข้อ ${n}: คะแนนต้องมากกว่า 0 และไม่เกิน 1000`);
      }
      points = Math.round(p * 100) / 100;
    }
    questions.push({ id: id.toLowerCase(), body, explanation, points, choices: choices as [string, string, string, string], correct });
  }

  return ok({
    settings: { title, instructions, scoring_mode: mode, equal_points: equalPoints, default_reveal_mode: reveal },
    questions,
  });
}

// ---------------------------------------------------------------------
// Bulk paste ("วางข้อสอบหลายข้อพร้อมกัน")
// ---------------------------------------------------------------------

export type ParsedQuestion = {
  body: string; choices: [string, string, string, string]; correct: Label | null; explanation: string;
};

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
const toAscii = (s: string) => s.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
const LETTER_TO_LABEL: Record<string, Label> = {
  ก: "ก", ข: "ข", ค: "ค", ง: "ง", a: "ก", b: "ข", c: "ค", d: "ง", A: "ก", B: "ข", C: "ค", D: "ง",
  "1": "ก", "2": "ข", "3": "ค", "4": "ง",
};

const RE_QSTART = /^\s*(?:ข้อ\s*)?([0-9๐-๙]+)\s*[.)\]:：]\s*(.*)$/;
const RE_CHOICE = /^\s*\(?([กขคงA-Da-d])\s*[.)\]:：]\s*(.*)$/;
const RE_ANSWER = /^\s*(?:เฉลย|คำตอบ|ตอบ|ans(?:wer)?)\s*(?:ที่ถูกต้อง|คือ)?\s*[:：\-]?\s*\(?([กขคงA-Da-d1-4๑-๔])\)?(?:\s*[.)\]]|\s|$)/i;
const RE_EXPL = /^\s*(?:คำอธิบาย|อธิบาย|เหตุผล|explanation)\s*[:：\-]?\s*(.*)$/i;

/** Parses text copied from Word/Notepad into questions.  Accepted layout (blank lines optional):
 *    1. คำถาม            (a number is optional if questions are separated by blank lines)
 *    ก. ตัวเลือก   ข. ...  ค. ...  ง. ...      (or A. B. C. D.)
 *    เฉลย: ข            (or "ตอบ ข", "Answer: B", "เฉลย 2")
 *    คำอธิบาย: ...       (optional)
 *  Lines that match nothing continue the previous field.  Problems are reported as warnings; the questions are still
 *  returned so the admin can fix them in the editor. */
export function parseBulkQuestions(text: string): { questions: ParsedQuestion[]; warnings: string[] } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const questions: ParsedQuestion[] = [];
  const warnings: string[] = [];

  type Cur = {
    body: string; choices: string[]; has: boolean[]; correct: Label | null; explanation: string;
    start: number; field: "body" | "c0" | "c1" | "c2" | "c3" | "exp" | null;
  };
  let cur: Cur | null = null;
  let blankBefore = false;

  const begin = (body: string, lineNo: number): Cur => ({
    body, choices: ["", "", "", ""], has: [false, false, false, false], correct: null, explanation: "",
    start: lineNo, field: "body",
  });
  const finish = () => {
    if (!cur) return;
    const n = questions.length + 1;
    const missing = LABELS.filter((_, i) => cur!.choices[i].trim() === "");
    if (cur.body.trim() === "") warnings.push(`ข้อที่ ${n} (บรรทัด ${cur.start}): ไม่พบคำถาม`);
    if (missing.length > 0) warnings.push(`ข้อที่ ${n} (บรรทัด ${cur.start}): ตัวเลือกไม่ครบ (ขาด ${missing.join(" ")})`);
    if (cur.correct === null) warnings.push(`ข้อที่ ${n} (บรรทัด ${cur.start}): ไม่พบเฉลย`);
    questions.push({
      body: cur.body.trim(),
      choices: cur.choices.map((c) => c.trim()) as [string, string, string, string],
      correct: cur.correct,
      explanation: cur.explanation.trim(),
    });
    cur = null;
  };
  const append = (c: Cur, text: string) => {
    if (c.field === null) return;
    if (c.field === "body") c.body = c.body === "" ? text : `${c.body}\n${text}`;
    else if (c.field === "exp") c.explanation = c.explanation === "" ? text : `${c.explanation}\n${text}`;
    else {
      const i = Number(c.field.slice(1));
      c.choices[i] = c.choices[i] === "" ? text : `${c.choices[i]}\n${text}`;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i].trimEnd();
    if (line.trim() === "") { blankBefore = true; continue; }
    const wasBlank = blankBefore;
    blankBefore = false;

    const qs = RE_QSTART.exec(line);
    // "1." could also be a numbered choice like "1. ..." inside a question that uses digits as labels: only treat it as a
    // new question when we are not in the middle of collecting choices that use digits (rare) — keep it simple.
    const answer = RE_ANSWER.exec(line);
    const expl = RE_EXPL.exec(line);
    const choice = RE_CHOICE.exec(line);

    if (answer && cur) {
      cur.correct = LETTER_TO_LABEL[toAscii(answer[1])] ?? null;
      cur.field = null;
      continue;
    }
    if (expl && cur) {
      cur.explanation = expl[1];
      cur.field = "exp";
      continue;
    }
    if (choice && cur && !(choice[1] && qs && !cur.has.some(Boolean) && wasBlank)) {
      const label = LETTER_TO_LABEL[choice[1]];
      const idx = LABELS.indexOf(label);
      if (cur.has[idx]) {
        // the same label again => this must be the next (unnumbered) question's first choice; keep the current one
        warnings.push(`บรรทัด ${lineNo}: ตัวเลือก ${label} ซ้ำในข้อเดียวกัน`);
      }
      cur.choices[idx] = choice[2];
      cur.has[idx] = true;
      cur.field = `c${idx}` as Cur["field"];
      continue;
    }
    if (choice && !cur) {
      warnings.push(`บรรทัด ${lineNo}: พบตัวเลือกก่อนคำถาม จึงข้ามบรรทัดนี้`);
      continue;
    }
    if (qs) {
      finish();
      cur = begin(qs[2], lineNo);
      continue;
    }
    // plain text
    if (!cur) { cur = begin(line.trim(), lineNo); continue; }
    const complete = cur.has.some(Boolean) || cur.correct !== null;
    if (wasBlank && complete) { finish(); cur = begin(line.trim(), lineNo); continue; }
    append(cur, line.trim());
  }
  finish();

  if (questions.length > MAX_QUESTIONS) warnings.push(`วางได้ไม่เกิน ${MAX_QUESTIONS} ข้อต่อครั้ง`);
  return { questions: questions.slice(0, MAX_QUESTIONS), warnings };
}
