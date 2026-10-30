"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { saveSetContent } from "@/lib/actions/sets";
import {
  LABELS, MAX_QUESTIONS, blankQuestion, parseBulkQuestions, problemsFor, totalPoints,
  type EditorQuestion, type EditorSettings, type Label, type Mode,
} from "@/lib/set-content";

type Status = "saved" | "dirty" | "saving" | "error";
const AUTOSAVE_MS = 3000;

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
const hasContent = (q: EditorQuestion) =>
  q.body.trim() !== "" || q.explanation.trim() !== "" || q.choices.some((c) => c.trim() !== "");

const Icon = {
  up: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>,
  down: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 5v14M5 12l7 7 7-7" /></svg>,
  copy: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>,
  trash: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>,
};

type CardProps = {
  q: EditorQuestion; index: number; total: number; mode: Mode;
  onChange: (id: string, patch: Partial<EditorQuestion>) => void;
  onChoice: (id: string, ci: number, text: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onChoiceKey: (id: string, ci: number, e: ReactKeyboardEvent<HTMLInputElement>) => void;
  register: (key: string, el: HTMLElement | null) => void;
};

// memo: typing in one question must not re-render the other (possibly hundreds of) cards
const QuestionCard = memo(function QuestionCard(p: CardProps) {
  const { q, index, total, mode } = p;
  const probs = problemsFor(q, mode);
  return (
    <section id={`q-${q.id}`} className={`q ${probs.length ? "has-problem" : "complete"}`}>
      <div className="q-head">
        <span className="q-no">ข้อ {index + 1}</span>
        <div className="actions">
          <button type="button" className="btn icon" disabled={index === 0} onClick={() => p.onMove(q.id, -1)} aria-label={`เลื่อนข้อ ${index + 1} ขึ้น`} title="เลื่อนขึ้น">{Icon.up}</button>
          <button type="button" className="btn icon" disabled={index === total - 1} onClick={() => p.onMove(q.id, 1)} aria-label={`เลื่อนข้อ ${index + 1} ลง`} title="เลื่อนลง">{Icon.down}</button>
          <button type="button" className="btn icon" onClick={() => p.onDuplicate(q.id)} aria-label={`ทำสำเนาข้อ ${index + 1}`} title="ทำสำเนา">{Icon.copy}</button>
          <button type="button" className="btn icon danger" onClick={() => p.onRemove(q.id)} aria-label={`ลบข้อ ${index + 1}`} title="ลบ">{Icon.trash}</button>
        </div>
      </div>

      {probs.length > 0 && <p className="small" style={{ color: "#8a5a0c" }}>ต้องแก้: {probs.join(" · ")}</p>}

      <label className="field">
        <span>คำถาม</span>
        <textarea ref={(el) => p.register(`${q.id}:body`, el)} value={q.body} maxLength={2000}
          onChange={(e) => p.onChange(q.id, { body: e.target.value })} />
      </label>

      <p className="hint">แตะตัวอักษรเพื่อกำหนดเป็นเฉลย (สีเขียว) · ในช่องตัวเลือก: Enter = ช่องถัดไป, Ctrl+Enter = ตั้งเป็นเฉลย</p>
      {LABELS.map((label, ci) => (
        <div className="choice" key={label}>
          <label className="tile" title={`ตั้งข้อ ${label} เป็นเฉลย`}>
            <input type="radio" name={`correct-${q.id}`} checked={q.correct === label}
              onChange={() => p.onChange(q.id, { correct: label })} aria-label={`เลือกข้อ ${label} เป็นเฉลย`} />
            <span>{label}</span>
          </label>
          <input type="text" ref={(el) => p.register(`${q.id}:c${ci}`, el)} value={q.choices[ci]} maxLength={500}
            placeholder={`ตัวเลือก ${label}`} aria-label={`ข้อความตัวเลือก ${label}`}
            onChange={(e) => p.onChoice(q.id, ci, e.target.value)}
            onKeyDown={(e) => p.onChoiceKey(q.id, ci, e)} />
        </div>
      ))}

      <div className="row" style={{ marginTop: ".75rem" }}>
        {mode === "custom" && (
          <label className="field" style={{ flex: "0 0 160px" }}>
            <span>คะแนนข้อนี้</span>
            <input type="number" value={q.points} min="0.01" max="1000" step="0.01"
              onChange={(e) => p.onChange(q.id, { points: e.target.value })} />
          </label>
        )}
        <label className="field">
          <span>คำอธิบายเฉลย (ไม่บังคับ)</span>
          <textarea value={q.explanation} maxLength={2000} style={{ minHeight: "3.5rem" }}
            onChange={(e) => p.onChange(q.id, { explanation: e.target.value })} />
        </label>
      </div>
    </section>
  );
});

export default function SetEditor({
  setId, initialSettings, initialQuestions,
}: { setId: string; initialSettings: EditorSettings; initialQuestions: EditorQuestion[] }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [questions, setQuestions] = useState(initialQuestions);
  const [status, setStatus] = useState<Status>("saved");
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [focusKey, setFocusKey] = useState<string | null>(null);

  // the editor is the single source of truth after first render: later server props are ignored on purpose
  const initialRef = useRef({ settings: initialSettings, questions: initialQuestions });
  const stateRef = useRef({ settings, questions });
  stateRef.current = { settings, questions };
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const savingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const refs = useRef(new Map<string, HTMLElement>());

  const register = useCallback((key: string, el: HTMLElement | null) => {
    if (el) refs.current.set(key, el);
    else refs.current.delete(key);
  }, []);

  // ---- saving: one request for everything, debounced autosave, never overlapping ----
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => { refreshTimer.current = null; router.refresh(); }, 1500);
  }, [router]);

  const save = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (savingRef.current) return;
    const v = versionRef.current;
    if (v === savedVersionRef.current) { setStatus("saved"); return; }

    savingRef.current = true;
    setStatus("saving");
    setError(null);
    let failed = false;
    let rejected = false; // the server understood the request but refused the content: retrying cannot help
    try {
      const res = await saveSetContent(setId, stateRef.current);
      if (res.ok) {
        savedVersionRef.current = v;
        setLastSaved(new Date(res.savedAt));
        scheduleRefresh(); // updates the "ready to open" panel on the server-rendered part of the page
      } else {
        failed = true;
        rejected = true;
        setError(res.error);
      }
    } catch {
      failed = true;
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ จะลองบันทึกใหม่อัตโนมัติ");
    } finally {
      savingRef.current = false;
    }
    if (failed) {
      setStatus("error");
      if (!rejected) timerRef.current = setTimeout(() => { void saveRef.current(); }, 6000);
    } else if (versionRef.current !== savedVersionRef.current) {
      setStatus("dirty");
      timerRef.current = setTimeout(() => { void saveRef.current(); }, 800); // edits arrived while saving
    } else {
      setStatus("saved");
    }
  }, [setId, scheduleRefresh]);
  saveRef.current = save;

  // any change => bump the version and (re)start the autosave countdown
  useEffect(() => {
    if (settings === initialRef.current.settings && questions === initialRef.current.questions) return;
    versionRef.current += 1;
    setStatus((s) => (s === "saving" ? s : "dirty"));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void saveRef.current(); }, AUTOSAVE_MS);
  }, [settings, questions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void saveRef.current(); }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (versionRef.current !== savedVersionRef.current || savingRef.current) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  // focus a field after it has been rendered (new question, keyboard navigation)
  useEffect(() => {
    if (!focusKey) return;
    const el = refs.current.get(focusKey);
    if (el) { el.focus(); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
    setFocusKey(null);
  }, [focusKey, questions]);

  // ---- editing: everything is local and instant ----
  const mode = settings.scoring_mode;
  const onChange = useCallback((id: string, patch: Partial<EditorQuestion>) => {
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }, []);
  const onChoice = useCallback((id: string, ci: number, text: string) => {
    setQuestions((qs) => qs.map((q) => {
      if (q.id !== id) return q;
      const choices = [...q.choices] as EditorQuestion["choices"];
      choices[ci] = text;
      return { ...q, choices };
    }));
  }, []);
  const onMove = useCallback((id: string, dir: -1 | 1) => {
    setQuestions((qs) => {
      const i = qs.findIndex((q) => q.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= qs.length) return qs;
      const next = [...qs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);
  const addQuestion = useCallback((afterId?: string) => {
    if (stateRef.current.questions.length >= MAX_QUESTIONS) return;
    const q = blankQuestion(newId());
    setQuestions((qs) => {
      const i = afterId ? qs.findIndex((x) => x.id === afterId) : qs.length - 1;
      const next = [...qs];
      next.splice(i + 1, 0, q);
      return next;
    });
    setFocusKey(`${q.id}:body`);
  }, []);
  const onDuplicate = useCallback((id: string) => {
    if (stateRef.current.questions.length >= MAX_QUESTIONS) return;
    const copy = newId();
    setQuestions((qs) => {
      const i = qs.findIndex((q) => q.id === id);
      if (i < 0) return qs;
      const next = [...qs];
      next.splice(i + 1, 0, { ...qs[i], id: copy, choices: [...qs[i].choices] as EditorQuestion["choices"] });
      return next;
    });
    setFocusKey(`${copy}:body`);
  }, []);
  const onRemove = useCallback((id: string) => {
    const q = stateRef.current.questions.find((x) => x.id === id);
    if (!q) return;
    if (hasContent(q) && !window.confirm("ลบข้อนี้ใช่หรือไม่?")) return;
    setQuestions((qs) => qs.filter((x) => x.id !== id));
  }, []);
  const onChoiceKey = useCallback((id: string, ci: number, e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return; // never steal Enter from Thai/IME composition
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { onChange(id, { correct: LABELS[ci] as Label }); return; }
    if (ci < 3) { setFocusKey(`${id}:c${ci + 1}`); return; }
    const qs = stateRef.current.questions;
    const i = qs.findIndex((q) => q.id === id);
    if (i >= 0 && i < qs.length - 1) setFocusKey(`${qs[i + 1].id}:body`);
    else addQuestion(id);
  }, [onChange, addQuestion]);

  const parsed = useMemo(() => (pasteText.trim() === "" ? null : parseBulkQuestions(pasteText)), [pasteText]);
  const importPasted = () => {
    if (!parsed || parsed.questions.length === 0) return;
    const room = MAX_QUESTIONS - stateRef.current.questions.length;
    const added: EditorQuestion[] = parsed.questions.slice(0, Math.max(room, 0)).map((p) => ({
      id: newId(), body: p.body, explanation: p.explanation, points: "1", choices: p.choices, correct: p.correct,
    }));
    if (added.length === 0) return;
    setQuestions((qs) => [...qs, ...added]);
    setPasteText("");
    setFocusKey(`${added[0].id}:body`);
  };

  const ready = questions.filter((q) => problemsFor(q, mode).length === 0).length;
  const total = totalPoints(questions, settings);
  const statusText: Record<Status, string> = {
    saved: lastSaved ? `บันทึกแล้ว ✓ (${lastSaved.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit" })})` : "ไม่มีการเปลี่ยนแปลง",
    dirty: "มีการแก้ไขที่ยังไม่บันทึก — จะบันทึกอัตโนมัติ",
    saving: "กำลังบันทึก…",
    error: "บันทึกไม่สำเร็จ",
  };

  return (
    <div>
      <section className="panel">
        <h2>ตั้งค่าชุดข้อสอบ</h2>
        <label className="field">
          <span>ชื่อชุดข้อสอบ</span>
          <input type="text" value={settings.title} maxLength={200} onChange={(e) => setSettings((s) => ({ ...s, title: e.target.value }))} />
        </label>
        <label className="field">
          <span>คำชี้แจงก่อนเริ่มสอบ</span>
          <textarea value={settings.instructions} maxLength={5000} onChange={(e) => setSettings((s) => ({ ...s, instructions: e.target.value }))} />
        </label>
        <div className="row">
          <label className="field">
            <span>วิธีคิดคะแนน</span>
            <select value={settings.scoring_mode} onChange={(e) => setSettings((s) => ({ ...s, scoring_mode: e.target.value as Mode }))}>
              <option value="equal">คะแนนเท่ากันทุกข้อ</option>
              <option value="custom">กำหนดคะแนนแยกแต่ละข้อ</option>
            </select>
          </label>
          {settings.scoring_mode === "equal" && (
            <label className="field">
              <span>คะแนนต่อข้อ</span>
              <input type="number" value={settings.equal_points} min="0.01" max="1000" step="0.01"
                onChange={(e) => setSettings((s) => ({ ...s, equal_points: e.target.value }))} />
            </label>
          )}
          <label className="field">
            <span>การแสดงเฉลยหลังสอบ (ค่าตั้งต้นของรอบสอบ)</span>
            <select value={settings.default_reveal_mode}
              onChange={(e) => setSettings((s) => ({ ...s, default_reveal_mode: e.target.value as EditorSettings["default_reveal_mode"] }))}>
              <option value="immediate">แสดงทันทีหลังส่งข้อสอบ</option>
              <option value="after_close">แสดงหลังสิ้นสุดรอบสอบ</option>
              <option value="hidden">ไม่แสดงเฉลย</option>
            </select>
          </label>
        </div>
      </section>

      <details className="panel paste">
        <summary><strong>วางข้อสอบหลายข้อพร้อมกัน</strong> <span className="muted small">(คัดลอกจาก Word / Notepad)</span></summary>
        <p className="small muted" style={{ marginTop: ".6rem" }}>
          รูปแบบ: <code>1. คำถาม</code> แล้วตามด้วย <code>ก. … ข. … ค. … ง. …</code> (หรือ A. B. C. D.) แล้วบรรทัด <code>เฉลย: ข</code> และ <code>คำอธิบาย: …</code> (ไม่บังคับ)
          ถ้าไม่ใส่เลขข้อ ให้เว้นบรรทัดว่างคั่นระหว่างข้อ
        </p>
        <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} style={{ minHeight: "11rem" }}
          placeholder={"1. เมืองหลวงของประเทศไทยคือ?\nก. เชียงใหม่\nข. กรุงเทพมหานคร\nค. ภูเก็ต\nง. ขอนแก่น\nเฉลย: ข\nคำอธิบาย: กรุงเทพมหานครเป็นเมืองหลวง"} />
        {parsed && (
          <div style={{ marginTop: ".6rem" }}>
            <p style={{ margin: 0 }}><strong>พบ {parsed.questions.length} ข้อ</strong>
              {parsed.warnings.length > 0 ? ` · มี ${parsed.warnings.length} จุดที่ควรตรวจ (เพิ่มแล้วแก้ในตัวแก้ไขได้)` : " · ครบถ้วน"}</p>
            {parsed.warnings.length > 0 && (
              <ul className="small" style={{ margin: ".3rem 0 0", paddingLeft: "1.2rem", color: "#8a5a0c" }}>
                {parsed.warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
                {parsed.warnings.length > 8 && <li>…และอีก {parsed.warnings.length - 8} จุด</li>}
              </ul>
            )}
          </div>
        )}
        <div className="actions" style={{ marginTop: ".75rem" }}>
          <button type="button" className="btn primary" disabled={!parsed || parsed.questions.length === 0} onClick={importPasted}>
            เพิ่ม {parsed ? parsed.questions.length : 0} ข้อเข้าชุดนี้
          </button>
          <button type="button" className="btn" disabled={pasteText === ""} onClick={() => setPasteText("")}>ล้าง</button>
        </div>
      </details>

      <div className="editor-summary" role="status">
        <strong>{questions.length} ข้อ</strong> · คะแนนเต็ม {total} · ครบถ้วน {ready}/{questions.length} ข้อ
      </div>

      {questions.length === 0 && <p className="muted">ยังไม่มีคำถาม กด “+ เพิ่มคำถาม” หรือวางข้อสอบหลายข้อจากด้านบน</p>}

      {questions.map((q, i) => (
        <QuestionCard key={q.id} q={q} index={i} total={questions.length} mode={mode}
          onChange={onChange} onChoice={onChoice} onMove={onMove} onDuplicate={onDuplicate} onRemove={onRemove}
          onChoiceKey={onChoiceKey} register={register} />
      ))}

      <div style={{ marginBottom: "5.5rem" }}>
        <button type="button" className="btn primary" onClick={() => addQuestion()} disabled={questions.length >= MAX_QUESTIONS}>
          + เพิ่มคำถาม
        </button>
      </div>

      <div className="savebar no-print">
        <div className={`savestatus ${status}`} aria-live="polite">
          {statusText[status]}
          {error && <span className="small"> — {error}</span>}
        </div>
        <button type="button" className="btn primary" onClick={() => void save()} disabled={status === "saving" || status === "saved"}>
          {status === "saving" ? "กำลังบันทึก…" : "บันทึกทั้งหมด"}
        </button>
      </div>
    </div>
  );
}
