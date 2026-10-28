"use client";
import type { ReactNode } from "react";

// A submit button that asks for confirmation first. `action` is a server action
// (usually pre-bound with .bind) and runs inside the surrounding <form>.
export default function ConfirmButton({
  action, message, className, ariaLabel, children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  message: string;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      formAction={action}
      formNoValidate
      className={className}
      aria-label={ariaLabel}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
