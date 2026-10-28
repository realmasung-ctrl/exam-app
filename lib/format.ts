export function fmtDate(v: string | null | undefined): string {
  if (!v) return "-";
  return new Date(v).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });
}
