import { getAdminOrNull } from "@/lib/auth";
import { serviceClient } from "@/lib/supabase/admin";
import { backupChunks, type FetchPage } from "@/lib/backup-logic";
import { formatBangkok } from "@/lib/results-logic";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/admin/backup  -> downloads ONE json file with every table (admins only).
// The file contains personal data (names), answer keys and results: treat it like the system itself.
export async function GET() {
  const admin = await getAdminOrNull();
  if (!admin) {
    return Response.json({ code: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const db = serviceClient();
  const fetchPage: FetchPage = async (table, order, from, to) => {
    let q = db.from(table).select("*");
    for (const col of order) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, to);
    return { rows: (data ?? []) as unknown[], error: error ? error.message : null };
  };

  const now = new Date();
  const gen = backupChunks(now.toISOString(), fetchPage);
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) controller.close();
        else controller.enqueue(enc.encode(value));
      } catch (e) {
        controller.error(e); // abort => the downloaded file is incomplete JSON and cannot be mistaken for a good backup
      }
    },
    async cancel() {
      await gen.return(undefined);
    },
  });

  const stamp = formatBangkok(now.toISOString()).replace(/[: ]/g, "-"); // 2026-10-30-09-15-00
  const name = `exam-app-backup-${stamp}.json`;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
