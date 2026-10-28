"use client";
import { useState } from "react";

export default function CopyButton({ text, label = "คัดลอกลิงก์" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("ok");
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const done = document.execCommand("copy");
        ta.remove();
        setState(done ? "ok" : "err");
      } catch {
        setState("err");
      }
    }
    setTimeout(() => setState("idle"), 2500);
  }

  return (
    <button type="button" className="btn" onClick={copy} aria-live="polite">
      {state === "ok" ? "คัดลอกแล้ว ✓" : state === "err" ? "คัดลอกไม่สำเร็จ — ให้เลือกลิงก์แล้วคัดลอกเอง" : label}
    </button>
  );
}
