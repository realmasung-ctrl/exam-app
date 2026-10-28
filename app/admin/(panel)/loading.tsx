// Shown instantly while an admin page is loading, so a click always gives visible feedback.
export default function Loading() {
  return (
    <div role="status" aria-live="polite">
      <div className="skeleton" style={{ width: "40%", height: 34, marginBottom: 16 }} />
      <div className="skeleton" style={{ width: "100%", height: 90, marginBottom: 12 }} />
      <div className="skeleton" style={{ width: "100%", height: 220 }} />
      <p className="muted small" style={{ marginTop: 12 }}>กำลังโหลดข้อมูล…</p>
    </div>
  );
}
