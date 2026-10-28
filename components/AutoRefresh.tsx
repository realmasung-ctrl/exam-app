"use client";
import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

// Re-renders the server page every few seconds, but NEVER while the user is clicking/typing,
// while the tab is hidden, or while the previous refresh is still running — a refresh in the middle of a
// click could otherwise swallow the navigation.
export default function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pendingRef = useRef(false);
  pendingRef.current = pending;
  const lastTouch = useRef(0);

  useEffect(() => {
    const touch = () => { lastTouch.current = Date.now(); };
    window.addEventListener("pointerdown", touch, true);
    window.addEventListener("keydown", touch, true);
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (pendingRef.current) return;
      if (Date.now() - lastTouch.current < 8000) return;
      startTransition(() => router.refresh());
    }, intervalMs);
    return () => {
      window.removeEventListener("pointerdown", touch, true);
      window.removeEventListener("keydown", touch, true);
      clearInterval(id);
    };
  }, [router, intervalMs]);

  return null;
}
