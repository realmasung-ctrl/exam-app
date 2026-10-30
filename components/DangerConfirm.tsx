"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

function ConfirmSubmit({ enabled, label }: { enabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn danger-solid" disabled={!enabled || pending}>
      {pending ? "กำลังลบ…" : label}
    </button>
  );
}

// A deliberate two-step confirmation for IRREVERSIBLE actions: opens a dialog that explains the consequences
// and only enables the red button after the admin ticks the acknowledgement box.
export default function DangerConfirm({
  action, triggerLabel, triggerClassName = "btn danger", title, confirmLabel, ackLabel, children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  triggerLabel: string;
  triggerClassName?: string;
  title: string;
  confirmLabel: string;
  ackLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus(); // the safe choice is focused first
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => { setAck(false); setOpen(true); }}>{triggerLabel}</button>
      {open && (
        <div className="modal-back" onClick={() => setOpen(false)}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="danger-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="danger-title">{title}</h2>
            <div className="danger-body">{children}</div>
            <form action={action}>
              <label className="ack">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>{ackLabel}</span>
              </label>
              <div className="actions" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="btn" ref={cancelRef} onClick={() => setOpen(false)}>ยกเลิก</button>
                <ConfirmSubmit enabled={ack} label={confirmLabel} />
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
