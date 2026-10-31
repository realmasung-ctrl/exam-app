"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin", label: "หน้าหลัก", exact: true },
  { href: "/admin/sets", label: "ชุดข้อสอบ", exact: false },
  { href: "/admin/sessions", label: "รอบสอบ / ลิงก์ / QR", exact: false },
  { href: "/admin/results", label: "ผลสอบ", exact: false },
  { href: "/admin/settings", label: "ตั้งค่าระบบ", exact: false },
  { href: "/admin/system", label: "ตรวจสอบระบบ / สำรองข้อมูล", exact: false },
];
const soon: string[] = [];

export default function AdminNav() {
  const path = usePathname() ?? "";
  return (
    <nav className="nav" aria-label="เมนูหลัก">
      {items.map((it) => {
        const active = it.exact ? path === it.href : path.startsWith(it.href);
        return (
          <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}>
            {it.label}
          </Link>
        );
      })}
      {soon.map((s) => (
        <span key={s} className="soon" title="เร็ว ๆ นี้">{s}</span>
      ))}
    </nav>
  );
}
