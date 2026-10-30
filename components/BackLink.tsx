import Link from "next/link";
import type { ReactNode } from "react";

// A real button-style "back" control (pill with an arrow icon) used on every admin sub-page.
export default function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="back">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 12H5M11 18l-6-6 6-6" />
      </svg>
      <span>{children}</span>
    </Link>
  );
}
