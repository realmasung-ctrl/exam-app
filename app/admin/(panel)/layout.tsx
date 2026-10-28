import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth";
import { logout } from "@/lib/actions/auth";
import AdminNav from "@/components/AdminNav";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAdmin();
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">ระบบสอบออนไลน์</div>
        <AdminNav />
        <form action={logout} className="side-foot">
          <div className="who">{profile.display_name}</div>
          <button className="btn" type="submit">ออกจากระบบ</button>
        </form>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
