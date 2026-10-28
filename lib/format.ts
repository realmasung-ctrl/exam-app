export function fmtDate(v: string | null | undefined): string {
  if (!v) return "-";
  return new Date(v).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });
}

export const SESSION_STATUS_LABEL: Record<string, string> = {
  draft: "ฉบับร่าง",
  open: "เปิดรับผู้เข้าสอบ",
  running: "กำลังสอบ",
  ended: "สิ้นสุดการสอบ",
  disabled: "ปิดใช้งาน",
};

export const REVEAL_LABEL: Record<string, string> = {
  immediate: "แสดงทันทีหลังส่งข้อสอบ",
  after_close: "แสดงหลังสิ้นสุดรอบสอบ",
  hidden: "ไม่แสดงเฉลย",
};

export function statusBadgeClass(status: string): string {
  if (status === "open" || status === "running") return "ok";
  if (status === "disabled") return "warn";
  return "";
}
