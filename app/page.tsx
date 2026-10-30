import Link from "next/link";

// Public home page. Students normally arrive through the link / QR code of an exam session (/e/<code>),
// so this page mainly serves administrators.
export default function Home() {
  return (
    <main className="login">
      <div className="panel" style={{ width: "min(460px, 100%)" }}>
        <h1>ระบบสอบออนไลน์</h1>
        <p className="muted">
          ผู้เข้าสอบ: กรุณาเปิดลิงก์หรือสแกน QR Code ที่ผู้ดูแลการสอบแจกให้
        </p>
        <div style={{ borderTop: "1px solid var(--line)", margin: "1.25rem 0 1rem" }} />
        <p className="small muted" style={{ marginBottom: ".6rem" }}>สำหรับผู้ดูแลระบบ</p>
        {/* /admin sends signed-out visitors to the login page and signed-in admins straight to the dashboard */}
        <Link className="btn primary" href="/admin" style={{ width: "100%", minHeight: 48 }}>
          เข้าสู่ระบบผู้ดูแล
        </Link>
      </div>
    </main>
  );
}
