"use client";

// Readable error page inside the admin layout (the menu stays usable).
export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="panel" role="alert">
      <h1>เกิดข้อผิดพลาดในการแสดงหน้านี้</h1>
      <p className="muted">ลองโหลดใหม่อีกครั้ง ถ้ายังเกิดซ้ำ ให้แจ้งผู้พัฒนาพร้อมรหัสด้านล่าง</p>
      {error.digest && <p className="small">รหัสข้อผิดพลาด: <code>{error.digest}</code></p>}
      <div className="actions">
        <button className="btn primary" onClick={reset}>ลองอีกครั้ง</button>
        <a className="btn" href="/admin">กลับหน้าหลัก</a>
      </div>
    </section>
  );
}
