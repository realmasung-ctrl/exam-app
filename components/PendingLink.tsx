"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";

// A link-styled button that shows a spinner and a busy label as soon as it is clicked.
export default function PendingLink({
  href, className, style, busyLabel, children,
}: { href: string; className?: string; style?: React.CSSProperties; busyLabel: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  return (
    <Link href={href} className={className} style={{ ...style, gap: ".6rem", pointerEvents: busy ? "none" : undefined }}
      aria-busy={busy} onClick={() => setBusy(true)}>
      {busy && (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
          </path>
        </svg>
      )}
      {busy ? busyLabel : children}
    </Link>
  );
}
