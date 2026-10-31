#!/usr/bin/env node
// Restores a backup file made by Settings > "ระบบ / สำรองข้อมูล" > download (needs Node 18+, no packages).
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/restore-backup.mjs backup.json --dry-run
//   ... node scripts/restore-backup.mjs backup.json --yes            (restore into an EMPTY project)
//   ... node scripts/restore-backup.mjs backup.json --yes --merge    (target already has data: rows with the same id are overwritten)
//
// Before restoring into a NEW Supabase project: run migrations 0001-0005 first, then create the first admin
// (npm run create-admin). Admin accounts are not part of the backup. Exam links and QR codes keep working because
// each session's public code is restored too.
import { readFileSync } from "node:fs";

const FORMAT = "exam-app-backup";
const VERSION = 1;
// parents before children (foreign keys); pk = columns used to match existing rows
const TABLES = [
  { name: "question_sets", pk: "id", nullify: ["created_by"] },
  { name: "questions", pk: "id" },
  { name: "answer_choices", pk: "id" },
  { name: "exam_sessions", pk: "id", nullify: ["created_by"] },
  { name: "session_questions", pk: "id" },
  { name: "session_choices", pk: "id" },
  { name: "exam_participants", pk: "id" },
  { name: "participant_answers", pk: "participant_id,session_question_id" },
  { name: "exam_results", pk: "participant_id" },
];
const CHUNK = 200;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const flag = (n) => args.includes(`--${n}`);
const URL_ = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function die(msg, code = 1) { console.error(`\n❌ ${msg}`); process.exit(code); }

if (!file) die("Usage: node scripts/restore-backup.mjs <backup.json> [--dry-run] [--yes] [--merge]", 2);

let data;
try { data = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
catch (e) { die(`Cannot read the file as JSON (is it complete? was the download interrupted?): ${e.message}`); }

if (data?.format !== FORMAT) die("This is not a backup file of this system.");
if (data.version !== VERSION) die(`Backup version ${data.version} is not supported by this script (expects ${VERSION}).`);
if (typeof data.tables !== "object" || data.tables === null || typeof data.counts !== "object" || data.counts === null) {
  die("The file is incomplete (no tables/counts section). Download a new backup.");
}
const have = {};
for (const t of TABLES) {
  const rows = data.tables[t.name];
  if (!Array.isArray(rows)) die(`Table ${t.name} is missing from the file.`);
  if (data.counts[t.name] !== rows.length) die(`Row count of ${t.name} does not match the file's own summary: the file is damaged.`);
  have[t.name] = rows.length;
}

console.log(`Backup created at: ${data.created_at}`);
for (const t of TABLES) console.log(`  ${t.name.padEnd(22)} ${String(have[t.name]).padStart(7)} rows`);
if (flag("dry-run")) { console.log("\n✅ Dry run: the file is valid. Nothing was changed."); process.exit(0); }

if (!/^https:\/\/[^/]+$/.test(URL_) || !KEY) die("Set SUPABASE_URL (https://...) and SUPABASE_SERVICE_ROLE_KEY in the environment.", 2);
if (!flag("yes")) die(`This will WRITE ${Object.values(have).reduce((a, b) => a + b, 0)} rows into ${URL_}. Run again with --yes to confirm (or --dry-run to only check the file).`, 2);

const headers = (extra = {}) => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...extra });

async function count(table) {
  const r = await fetch(`${URL_}/rest/v1/${table}?select=*`, { headers: headers({ Prefer: "count=exact", Range: "0-0" }) });
  if (!r.ok) die(`Cannot read ${table} on the target (${r.status}). Did you run migrations 0001-0005? ${await r.text()}`);
  const m = /\/(\d+|\*)$/.exec(r.headers.get("content-range") ?? "");
  return m && m[1] !== "*" ? Number(m[1]) : 0;
}

console.log(`\nTarget: ${URL_}`);
const existing = (await count("question_sets")) + (await count("exam_sessions"));
if (existing > 0 && !flag("merge")) {
  die(`The target already contains data (${existing} sets/sessions). Use a fresh project, or add --merge to overwrite rows that have the same id.`, 2);
}

for (const t of TABLES) {
  const rows = data.tables[t.name].map((r) => {
    if (!t.nullify) return r;
    const copy = { ...r };
    for (const c of t.nullify) copy[c] = null; // admin accounts are not in the backup
    return copy;
  });
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const r = await fetch(`${URL_}/rest/v1/${t.name}?on_conflict=${t.pk}`, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(part),
    });
    if (!r.ok) die(`Writing ${t.name} failed at row ${i} (${r.status}): ${await r.text()}\nNothing after this point was written. Fix the cause and run the same command again (it is safe to repeat).`);
  }
  console.log(`  restored ${t.name.padEnd(22)} ${String(rows.length).padStart(7)} rows`);
}

console.log("\nVerifying row counts on the target...");
let bad = 0;
for (const t of TABLES) {
  const n = await count(t.name);
  const ok = n >= have[t.name];
  if (!ok) bad++;
  console.log(`  ${ok ? "✅" : "❌"} ${t.name.padEnd(22)} target has ${n}, backup had ${have[t.name]}`);
}
if (bad > 0) die("Some tables have fewer rows than the backup. Do not use this system until it is resolved.");
console.log("\n✅ Restore finished. Next: create the first admin if the project is new (npm run create-admin), then run supabase/tests/security.sql.");
