"use client";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

// Disables itself while the form is being submitted so a double tap cannot start two attempts.
export default function StartButton({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn primary" type="submit" disabled={pending} style={{ width: "100%", minHeight: 52 }}>
      {pending ? "กำลังเริ่มการสอบ…" : children}
    </button>
  );
}
