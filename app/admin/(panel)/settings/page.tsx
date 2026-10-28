import { requireAdmin } from "@/lib/auth";
import { serviceClient } from "@/lib/supabase/admin";
import { createAdmin, changeMyPassword } from "@/lib/actions/admins";
import { fmtDate } from "@/lib/format";
import Flash from "@/components/Flash";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { ok, err } = await searchParams;
  const { user } = await requireAdmin();
  const db = serviceClient();

  const [{ data: profiles }, usersRes] = await Promise.all([
    db.from("admin_profiles").select("id, display_name, created_at").order("created_at"),
    db.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);
  const emails = new Map<string, string>(
    (usersRes.data?.users ?? []).map((u: { id: string; email?: string }) => [u.id, u.email ?? ""]),
  );

  return (
    <>
      <div className="page-head"><h1>ตั้งค่าระบบ</h1></div>
      <Flash ok={ok} err={err} />

      <section className="panel">
        <h2>ผู้ดูแลระบบ</h2>
        <ul className="list">
          {(profiles ?? []).map((p: { id: string; display_name: string; created_at: string }) => (
            <li key={p.id}>
              <div>
                <strong>{p.display_name}</strong>{p.id === user.id && <span className="badge ok" style={{ marginLeft: ".5rem" }}>คุณ</span>}
                <div className="muted small">{emails.get(p.id) ?? ""}</div>
              </div>
              <span className="muted small">เพิ่มเมื่อ {fmtDate(p.created_at)}</span>
            </li>
          ))}
        </ul>
      </section>

      <form action={createAdmin} className="panel">
        <h2>เพิ่มผู้ดูแลระบบ</h2>
        <p className="muted small">ระบบไม่เปิดให้สมัครเอง ผู้ดูแลที่มีอยู่แล้วเป็นผู้สร้างบัญชีให้ แล้วแจ้งรหัสผ่านชั่วคราวกับเจ้าตัวโดยตรง</p>
        <div className="row">
          <label className="field"><span>อีเมล</span><input type="email" name="email" required /></label>
          <label className="field"><span>ชื่อที่แสดง</span><input type="text" name="display_name" maxLength={100} required /></label>
          <label className="field"><span>รหัสผ่านชั่วคราว (อย่างน้อย 10 ตัว)</span><input type="password" name="password" minLength={10} autoComplete="new-password" required /></label>
        </div>
        <button className="btn primary" type="submit">สร้างบัญชี</button>
      </form>

      <form action={changeMyPassword} className="panel">
        <h2>เปลี่ยนรหัสผ่านของฉัน</h2>
        <div className="row">
          <label className="field"><span>รหัสผ่านใหม่</span><input type="password" name="password" minLength={10} autoComplete="new-password" required /></label>
          <label className="field"><span>ยืนยันรหัสผ่านใหม่</span><input type="password" name="confirm" minLength={10} autoComplete="new-password" required /></label>
        </div>
        <button className="btn primary" type="submit">เปลี่ยนรหัสผ่าน</button>
      </form>
    </>
  );
}
