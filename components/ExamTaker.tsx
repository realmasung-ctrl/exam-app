"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatClock, mergeAnswers, nextSeq, remainingFrom, timerLevel } from "@/lib/exam-logic";

type Choice = { label: string; body: string };
type Question = { id: string; position: number; body: string; choices: Choice[] };
type SaveState = "saved" | "saving" | "error" | "offline";
type SendResult = "ok" | "expired" | "submitted" | "fatal" | "drop";
type Unsaved = { label: string | null; seq: number };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function sendAnswer(code: string, qid: string, item: Unsaved): Promise<SendResult> {
  const res = await fetch(`/api/exam/${code}/answer`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question_id: qid, label: item.label, seq: item.seq }),
    cache: "no-store",
  });
  if (res.ok) return "ok";
  const j = (await res.json().catch(() => ({}))) as { code?: string };
  if (res.status === 409 && j.code === "EXPIRED") return "expired";
  if (res.status === 409 && j.code === "ALREADY_SUBMITTED") return "submitted";
  if (res.status === 401 || res.status === 403) return "fatal";
  if (res.status === 400) return "drop"; // will never succeed; do not retry forever
  throw new Error("save failed"); // network / 5xx: retry
}

export default function ExamTaker({
  code, title, studentName, questions, initialAnswers, initialSeq, remainingMs,
}: {
  code: string;
  title: string;
  studentName: string;
  questions: Question[];
  initialAnswers: Record<string, string>;
  initialSeq: number;
  remainingMs: number;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [remaining, setRemaining] = useState(remainingMs);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  // Time is measured with performance.now() (monotonic): changing the phone's clock cannot extend the exam.
  const endAt = useRef(0);
  const seqRef = useRef(0);
  const unsaved = useRef<Map<string, Unsaved>>(new Map());
  const flushing = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(1000);
  const submittingRef = useRef(false);
  const resultUrl = `/e/${code}/result`;

  const flushRef = useRef<() => Promise<void>>(async () => {});
  const finishRef = useRef<(auto: boolean) => Promise<void>>(async () => {});
  const resyncRef = useRef<() => Promise<void>>(async () => {});

  // ---- clock ---------------------------------------------------------------
  useEffect(() => {
    endAt.current = performance.now() + remainingMs;
    seqRef.current = nextSeq(0, initialSeq, Date.now());
    const id = setInterval(() => setRemaining(Math.max(0, endAt.current - performance.now())), 250);
    return () => clearInterval(id);
  }, [remainingMs, initialSeq]);

  useEffect(() => {
    if (remaining <= 0) void finishRef.current(true);
  }, [remaining]);

  // ---- saving answers (latest choice per question wins; retried until the server confirms) ----
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    setSaveState("saving");
    try {
      while (unsaved.current.size > 0) {
        const first = unsaved.current.entries().next();
        if (first.done) break;
        const [qid, item] = first.value;
        const r = await sendAnswer(code, qid, item);
        if (r === "expired") { unsaved.current.clear(); void finishRef.current(true); break; }
        if (r === "submitted") { unsaved.current.clear(); router.replace(resultUrl); break; }
        if (r === "fatal") {
          unsaved.current.clear();
          setFatal("ไม่พบการเข้าสอบของคุณในเบราว์เซอร์นี้ กรุณาแจ้งผู้ดูแลการสอบ");
          break;
        }
        if (unsaved.current.get(qid)?.seq === item.seq) unsaved.current.delete(qid);
      }
      retryDelay.current = 1000;
      setSaveState(unsaved.current.size === 0 ? "saved" : "saving");
    } catch {
      setSaveState(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
      const delay = retryDelay.current;
      retryDelay.current = Math.min(delay * 2, 10_000);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => { void flushRef.current(); }, delay);
    } finally {
      flushing.current = false;
    }
  }, [code, router, resultUrl]);
  flushRef.current = flush;

  const drain = useCallback(async (maxMs: number): Promise<boolean> => {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      while (flushing.current) await sleep(100);
      if (unsaved.current.size === 0) return true;
      await flushRef.current();
      if (unsaved.current.size === 0) return true;
      await sleep(500);
    }
    return unsaved.current.size === 0;
  }, []);

  // ---- submit (manual or automatic when time is up) ----------------------------
  const finish = useCallback(async (auto: boolean) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setConfirmOpen(false);
    setMessage(null);

    if (auto) await sleep(1200); // let the server clock pass the deadline so it is recorded as "timed out"
    const saved = await drain(auto ? 5000 : 8000);
    if (!saved && !auto) {
      setMessage("ยังบันทึกคำตอบบางข้อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วกดส่งข้อสอบอีกครั้ง");
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    for (;;) {
      try {
        const res = await fetch(`/api/exam/${code}/submit`, { method: "POST", cache: "no-store" });
        if (res.ok) { router.replace(resultUrl); return; }
        if (res.status === 401 || res.status === 403) {
          setFatal("ไม่พบการเข้าสอบของคุณในเบราว์เซอร์นี้ กรุณาแจ้งผู้ดูแลการสอบ");
          return;
        }
      } catch {
        // network problem: handled below
      }
      if (!auto) {
        setMessage("ส่งข้อสอบไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วกดส่งข้อสอบอีกครั้ง");
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }
      await sleep(3000); // time is up: keep retrying; the server also grades expired attempts by itself
    }
  }, [code, drain, router, resultUrl]);
  finishRef.current = finish;

  // ---- re-sync with the server (time left + saved answers) ---------------------
  const resync = useCallback(async () => {
    try {
      const t0 = performance.now();
      const res = await fetch(`/api/exam/${code}/state`, { cache: "no-store" });
      if (res.status === 401) {
        setFatal("ไม่พบการเข้าสอบของคุณในเบราว์เซอร์นี้ กรุณาแจ้งผู้ดูแลการสอบ");
        return;
      }
      if (!res.ok) return;
      const rtt = performance.now() - t0;
      const s = (await res.json()) as {
        status: string; deadline_at?: string; server_now?: string;
        answers?: Record<string, string>; max_seq?: number;
      };
      if (s.status !== "in_progress") { router.replace(resultUrl); return; }
      if (s.deadline_at && s.server_now) {
        endAt.current = performance.now() + remainingFrom(s.deadline_at, s.server_now, rtt);
      }
      if (s.answers) setAnswers(mergeAnswers(s.answers, unsaved.current));
      if (typeof s.max_seq === "number") seqRef.current = nextSeq(seqRef.current, s.max_seq, 0);
      if (unsaved.current.size === 0) setSaveState("saved");
    } catch {
      // offline: the next attempt happens on "online" / tab focus / the 60 s heartbeat
    }
  }, [code, router, resultUrl]);
  resyncRef.current = resync;

  useEffect(() => {
    const onOnline = () => { void resyncRef.current(); void flushRef.current(); };
    const onOffline = () => setSaveState("offline");
    const onVisible = () => { if (document.visibilityState === "visible") void resyncRef.current(); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (unsaved.current.size > 0) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("beforeunload", onBeforeUnload);
    void resyncRef.current(); // right after load: replaces the (slightly stale) server-render time
    const id = setInterval(() => { void resyncRef.current(); }, 60_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearInterval(id);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setConfirmOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen]);

  // ---- UI ------------------------------------------------------------------
  const locked = remaining <= 0 || submitting;

  function choose(qid: string, label: string) {
    if (locked) return;
    seqRef.current = nextSeq(seqRef.current, 0, Date.now());
    unsaved.current.set(qid, { label, seq: seqRef.current });
    setAnswers((a) => ({ ...a, [qid]: label }));
    void flushRef.current();
  }

  if (fatal) {
    return (
      <main className="login">
        <div className="panel"><h1>ไม่สามารถทำข้อสอบต่อได้</h1><p>{fatal}</p></div>
      </main>
    );
  }

  if (questions.length === 0) {
    return <main className="login"><div className="panel"><p>รอบสอบนี้ยังไม่มีคำถาม กรุณาแจ้งผู้ดูแล</p></div></main>;
  }

  const q = questions[index];
  const answeredCount = questions.filter((x) => answers[x.id]).length;
  const unanswered = questions.map((x, i) => (answers[x.id] ? 0 : i + 1)).filter((n) => n > 0);
  const level = timerLevel(remaining);
  const saveText: Record<SaveState, string> = {
    saved: "บันทึกแล้ว ✓",
    saving: "กำลังบันทึก…",
    error: "บันทึกไม่สำเร็จ — กำลังลองใหม่อัตโนมัติ",
    offline: "ไม่มีอินเทอร์เน็ต — คำตอบจะบันทึกเมื่อกลับมาออนไลน์",
  };

  return (
    <div className="exam">
      <header className="exam-top">
        <div className="exam-meta">
          <strong>{title}</strong>
          <span className="muted small">{studentName}</span>
        </div>
        <div className={`timer ${level}`} role="timer" aria-label="เวลาที่เหลือ">{formatClock(remaining)}</div>
      </header>

      <div className="bar" aria-hidden><i style={{ width: `${(answeredCount / questions.length) * 100}%` }} /></div>
      <div className="exam-sub">
        <span>ตอบแล้ว {answeredCount} จาก {questions.length} ข้อ</span>
        <span className={`savestate ${saveState}`} aria-live="polite">{saveText[saveState]}</span>
      </div>

      {remaining <= 0 && <div className="flash err" role="alert">หมดเวลาแล้ว กำลังส่งคำตอบของคุณ…</div>}
      {remaining > 0 && level === "danger" && <div className="flash err" role="alert">เหลือเวลาไม่ถึง 1 นาที</div>}
      {remaining > 60_000 && level === "warn" && <div className="flash warn" role="status">เหลือเวลาไม่ถึง 5 นาที</div>}
      {message && <div className="flash err" role="alert">{message}</div>}

      <section className="panel">
        <p className="muted small">ข้อ {index + 1} / {questions.length}</p>
        <p className="exam-q">{q.body}</p>
        {q.choices.map((c) => (
          <button key={c.label} type="button" className="opt" aria-pressed={answers[q.id] === c.label}
            disabled={locked} onClick={() => choose(q.id, c.label)}>
            <b>{c.label}</b><span>{c.body}</span>
          </button>
        ))}
      </section>

      <div className="actions" style={{ justifyContent: "space-between" }}>
        <button className="btn" disabled={index === 0} onClick={() => setIndex(index - 1)}>← ข้อก่อนหน้า</button>
        <button className="btn" disabled={index === questions.length - 1} onClick={() => setIndex(index + 1)}>ข้อถัดไป →</button>
      </div>

      <div className="grid" role="group" aria-label="เลือกข้อ">
        {questions.map((x, n) => (
          <button key={x.id} type="button" className={`${answers[x.id] ? "done" : ""} ${n === index ? "cur" : ""}`}
            aria-label={`ไปข้อ ${n + 1}${answers[x.id] ? " (ตอบแล้ว)" : " (ยังไม่ได้ตอบ)"}`} onClick={() => setIndex(n)}>
            {n + 1}
          </button>
        ))}
      </div>

      <button className="btn primary" style={{ width: "100%", minHeight: 52 }} disabled={locked}
        onClick={() => setConfirmOpen(true)}>
        {submitting ? "กำลังส่งข้อสอบ…" : "ส่งข้อสอบ"}
      </button>

      {confirmOpen && (
        <div className="modal-back" onClick={() => setConfirmOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"
            onClick={(e) => e.stopPropagation()}>
            <h2 id="confirm-title">ยืนยันการส่งข้อสอบ</h2>
            {unanswered.length > 0 ? (
              <p>
                คุณยังไม่ได้ตอบ <strong>{unanswered.length} ข้อ</strong>
                {unanswered.length <= 20 ? ` (ข้อ ${unanswered.join(", ")})` : ""} ข้อที่ไม่ได้ตอบจะได้ 0 คะแนน
              </p>
            ) : (
              <p>คุณตอบครบทุกข้อแล้ว</p>
            )}
            <p className="muted small">เมื่อส่งแล้ว จะแก้ไขคำตอบไม่ได้อีก</p>
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setConfirmOpen(false)}>กลับไปตอบ</button>
              <button className="btn primary" onClick={() => void finish(false)}>ยืนยันส่งข้อสอบ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
