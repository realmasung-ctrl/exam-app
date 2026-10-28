import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getAdminOrNull } from "@/lib/auth";
import { loadSessionResults } from "@/lib/results";
import { EXPORT_HEADERS, exportRow, safeFilename, toCsv, formatBangkok } from "@/lib/results-logic";
import { isUuid } from "@/lib/validation";

export const dynamic = "force-dynamic";

const deny = (status: number, code: string) =>
  NextResponse.json({ code }, { status, headers: { "Cache-Control": "no-store" } });

// GET /api/admin/sessions/<id>/export?format=csv|xlsx   (admins only; the middleware does not cover /api)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminOrNull();
  if (!admin) return deny(401, "UNAUTHORIZED");

  const { id } = await params;
  if (!isUuid(id)) return deny(404, "NOT_FOUND");
  const format = new URL(req.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const data = await loadSessionResults(id);
  if (!data) return deny(404, "NOT_FOUND");

  const stamp = formatBangkok(new Date().toISOString()).slice(0, 10);
  const base = `ผลสอบ-${safeFilename(data.session.title)}-${stamp}`;
  const disposition = (ext: string) =>
    `attachment; filename="results.${ext}"; filename*=UTF-8''${encodeURIComponent(`${base}.${ext}`)}`;
  const body = data.rows.map(exportRow);

  if (format === "csv") {
    // BOM so Excel opens Thai text correctly
    return new Response("\uFEFF" + toCsv(EXPORT_HEADERS, body), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": disposition("csv"),
        "Cache-Control": "no-store",
      },
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "ระบบสอบออนไลน์";
  const ws = wb.addWorksheet("ผลสอบ", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(EXPORT_HEADERS);
  for (const r of body) ws.addRow(r); // strings are stored as text (never as formulas); numbers stay numeric
  ws.getRow(1).font = { bold: true };
  const widths = [8, 16, 18, 16, 20, 20, 16, 12, 12, 12, 10, 10, 12, 16, 24];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (const col of [8, 9, 10]) ws.getColumn(col).numFmt = "0.##";

  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": disposition("xlsx"),
      "Cache-Control": "no-store",
    },
  });
}
