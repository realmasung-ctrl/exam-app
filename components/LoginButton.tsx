"use client";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

const Spinner = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
    </path>
  </svg>
);

// Shows that the login is in progress. `pending` alone can flip back to false while the next page is still
// loading after the redirect, so once a submit has started the button stays busy until the page changes.
// The parent gives this component a new `key` after a failed attempt, which resets it.
export default function LoginButton() {
  const { pending } = useFormStatus();
  const [started, setStarted] = useState(false);
  useEffect(() => { if (pending) setStarted(true); }, [pending]);
  const busy = pending || started;

  return (
    <>
      <button className="btn primary" type="submit" disabled={busy} aria-busy={busy}
        style={{ width: "100%", minHeight: 48, gap: ".6rem" }}>
        {busy && <Spinner />}
        {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
      </button>
      {busy && (
        <p className="small muted" role="status" style={{ margin: ".75rem 0 0", textAlign: "center" }}>
          กำลังตรวจสอบบัญชีและเปิดหน้าผู้ดูแล อาจใช้เวลาไม่กี่วินาที
        </p>
      )}
    </>
  );
}
