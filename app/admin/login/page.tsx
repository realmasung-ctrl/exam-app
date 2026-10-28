import { login } from "@/lib/actions/auth";

const MESSAGES: Record<string, string> = {
  missing: "กรุณากรอกอีเมลและรหัสผ่าน",
  invalid: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  forbidden: "บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <form action={login} className="panel">
        <h1>เข้าสู่ระบบผู้ดูแล</h1>
        <p className="muted">ระบบสอบออนไลน์</p>
        {error && MESSAGES[error] && <div className="flash err" role="alert">{MESSAGES[error]}</div>}
        <label className="field">
          <span>อีเมล</span>
          <input type="email" name="email" autoComplete="username" required autoFocus />
        </label>
        <label className="field">
          <span>รหัสผ่าน</span>
          <input type="password" name="password" autoComplete="current-password" required />
        </label>
        <button className="btn primary" type="submit" style={{ width: "100%" }}>เข้าสู่ระบบ</button>
      </form>
    </main>
  );
}
