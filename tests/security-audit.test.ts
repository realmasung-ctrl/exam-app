// Static security audit of the source tree. It cannot prove the app is secure, but it fails loudly if a future
// change removes a protection that the design depends on (auth checks, answer-key isolation, DB lockdown...).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const norm = (p: string) => relative(ROOT, p).split("\\").join("/");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const read = (p: string) => readFileSync(p, "utf8");
/** Code without comments (a comment saying "never select is_correct" is fine; code selecting it is not). */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const srcFiles = ["app", "lib", "components"].flatMap((d) => walk(join(ROOT, d))).filter((f) => /\.(ts|tsx)$/.test(f));
const under = (prefix: string) => srcFiles.filter((f) => norm(f).startsWith(prefix));

/** Body text of every `export async function` in a file, keyed by name. */
function exportedFunctions(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /export async function (\w+)\s*\(/g;
  const hits: { name: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) hits.push({ name: m[1], at: m.index });
  hits.forEach((h, i) => out.set(h.name, text.slice(h.at, i + 1 < hits.length ? hits[i + 1].at : text.length)));
  return out;
}

test("every admin server action checks the admin before doing anything", () => {
  for (const file of ["sets", "sessions", "results", "admins"]) {
    const text = read(join(ROOT, `lib/actions/${file}.ts`));
    assert.match(text, /^"use server";/, `${file}.ts must be a server-actions file`);
    const fns = exportedFunctions(text);
    assert.ok(fns.size > 0, `${file}.ts exports no actions?`);
    for (const [name, body] of fns) {
      const head = body.slice(0, 400);
      assert.match(head, /await requireAdmin\(\)/, `${file}.${name} does not call requireAdmin() first`);
    }
  }
});

test("the only server actions without admin checks are login/logout/startExam", () => {
  const open = new Set<string>();
  for (const f of under("lib/actions/")) {
    for (const [name, body] of exportedFunctions(read(f))) {
      if (!/requireAdmin\(\)/.test(body.slice(0, 400))) open.add(name);
    }
  }
  assert.deepEqual([...open].sort(), ["login", "logout", "startExam"]);
});

test("admin API routes verify the admin; admin pages sit behind the panel layout", () => {
  for (const f of under("app/api/admin/")) {
    assert.match(read(f), /getAdminOrNull\(\)/, `${norm(f)} must call getAdminOrNull()`);
  }
  const layout = read(join(ROOT, "app/admin/(panel)/layout.tsx"));
  assert.match(layout, /requireAdmin\(\)/);
  // no admin page may live outside the protected group, except the login page
  const adminPages = srcFiles.map(norm).filter((f) => f.startsWith("app/admin/") && /\/page\.tsx$/.test(f));
  for (const p of adminPages) {
    assert.ok(p.startsWith("app/admin/(panel)/") || p === "app/admin/login/page.tsx", `unprotected admin page: ${p}`);
  }
  const mw = read(join(ROOT, "middleware.ts"));
  assert.match(mw, /\/admin\/:path\*/);
});

test("student API routes identify the student ONLY by the cookie token and are CSRF-checked", () => {
  const routes = under("app/api/exam/").filter((f) => /route\.ts$/.test(f));
  assert.ok(routes.length >= 4, "expected start/answer/submit/state routes");
  for (const f of routes) {
    const t = read(f);
    const name = norm(f);
    if (/\/start\/route\.ts$/.test(name)) {
      assert.match(t, /startAttemptFor\(/);
    } else {
      assert.ok(/tokenHash\(/.test(t) || /loadAttempt\(/.test(t), `${name} must derive the student from the cookie token`);
    }
    if (/export async function (PUT|POST|PATCH|DELETE)/.test(t)) {
      assert.match(t, /sameOrigin\(req\)/, `${name} mutates data but has no origin check`);
    }
    // never read the participant/session from the request body or URL query
    assert.doesNotMatch(t, /searchParams\.get\(["'](participant|token|session)/, `${name} trusts a client-supplied identity`);
    assert.doesNotMatch(t, /body\.(participant|participant_id|token|token_hash|session_id)\b/, `${name} trusts a client-supplied identity`);
  }
});

test("the answer key never reaches the exam screens or the student API", () => {
  const studentFiles = [
    ...under("app/api/exam/"),
    ...srcFiles.filter((f) => norm(f) === "app/e/[code]/take/page.tsx"),
    ...srcFiles.filter((f) => norm(f) === "app/e/[code]/page.tsx"),
    ...srcFiles.filter((f) => norm(f) === "components/ExamTaker.tsx"),
    ...srcFiles.filter((f) => norm(f) === "lib/exam.ts"),
  ];
  assert.ok(studentFiles.length >= 8);
  for (const f of studentFiles) {
    assert.doesNotMatch(code(f), /is_correct|isCorrect/, `${norm(f)} must never handle the answer key`);
  }
  // the result page may read the key, but only inside the block guarded by canReveal()
  const result = code(join(ROOT, "app/e/[code]/result/page.tsx"));
  const decided = result.indexOf("const revealAllowed = canReveal(");
  const guard = result.indexOf("if (revealAllowed)");
  const keyQuery = result.indexOf("session_choices(label, body, is_correct)");
  assert.ok(decided !== -1 && guard > decided, "result page must compute revealAllowed with canReveal()");
  assert.ok(keyQuery > guard, "the answer-key query must sit inside the `if (revealAllowed)` block");
  assert.equal(result.split("session_choices(label, body, is_correct)").length - 1, 1, "answer key must be queried exactly once");
});

test("no script injection / dynamic code paths", () => {
  for (const f of srcFiles) {
    const t = read(f);
    assert.doesNotMatch(t, /dangerouslySetInnerHTML/, `${norm(f)} uses dangerouslySetInnerHTML`);
    assert.doesNotMatch(t, /\beval\(|new Function\(/, `${norm(f)} evaluates dynamic code`);
    assert.doesNotMatch(t, /\.innerHTML\s*=/, `${norm(f)} writes innerHTML`);
  }
});

test("service-role key and server-only modules never reach client components", () => {
  const SERVER_ONLY = /from "@\/lib\/(supabase\/admin|supabase\/server|auth|exam|exam-start|results|url)"/;
  for (const f of srcFiles) {
    const t = read(f);
    if (/^"use client";/.test(t)) {
      assert.doesNotMatch(t, SERVER_ONLY, `client component ${norm(f)} imports a server-only module`);
      assert.doesNotMatch(t, /process\.env\.(?!NEXT_PUBLIC_)/, `client component ${norm(f)} reads a private env var`);
    }
  }
  const users = srcFiles.filter((f) => /SUPABASE_SERVICE_ROLE_KEY/.test(read(f))).map(norm);
  assert.deepEqual(users, ["lib/supabase/admin.ts"]);
  for (const name of ["lib/supabase/admin.ts", "lib/supabase/server.ts", "lib/auth.ts", "lib/exam.ts", "lib/exam-start.ts", "lib/results.ts", "lib/url.ts"]) {
    assert.match(read(join(ROOT, name)), /^import "server-only";/m, `${name} must import "server-only"`);
  }
  for (const f of walk(join(ROOT, "app")).concat(walk(join(ROOT, "components")))) {
    assert.doesNotMatch(read(f), /NEXT_PUBLIC_[A-Z_]*SERVICE/i, `${norm(f)} would expose the service key`);
  }
});

test("exam token cookie is HttpOnly + SameSite and created in one place", () => {
  const exam = read(join(ROOT, "lib/exam.ts"));
  const opts = exam.slice(exam.indexOf("examCookieOptions"));
  assert.match(opts, /httpOnly: true/);
  assert.match(opts, /sameSite: "lax"/);
  assert.match(opts, /secure: process\.env\.NODE_ENV === "production"/);
  for (const f of srcFiles.filter((f) => /cookies\(\)\)\.set\(|cookies\.set\(/.test(read(f)))) {
    const n = norm(f);
    if (n === "lib/supabase/server.ts" || n === "lib/supabase/middleware.ts") continue; // Supabase auth cookies
    assert.match(read(f), /examCookieOptions\(\)/, `${n} sets a cookie without the shared secure options`);
  }
});

test("exports are formula-injection safe and admin-only", () => {
  const exp = read(join(ROOT, "app/api/admin/sessions/[id]/export/route.ts"));
  assert.match(exp, /toCsv\(/);
  assert.match(exp, /if \(data\.error\)/);
  const logic = read(join(ROOT, "lib/results-logic.ts"));
  assert.match(logic, /\[=\+\\-@\\t\\r\]/);
});

test("secrets are not committed", () => {
  const ignore = read(join(ROOT, ".gitignore"));
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.env\.\*$/m);
  const all = [...srcFiles, ...walk(join(ROOT, "scripts")), ...walk(join(ROOT, "supabase")), join(ROOT, "package.json"), join(ROOT, ".env.example")]
    .filter((f) => existsSync(f));
  for (const f of all) {
    const t = read(f);
    assert.doesNotMatch(t, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, `${norm(f)} contains a JWT-like secret`);
    assert.doesNotMatch(t, /sb_secret_[A-Za-z0-9]/, `${norm(f)} contains a Supabase secret key`);
  }
  const envExample = read(join(ROOT, ".env.example"));
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_[A-Z_]*SERVICE/);
});

test("database: every table has RLS enabled; every function is SECURITY DEFINER with a fixed search_path", () => {
  const schema = read(join(ROOT, "supabase/migrations/0001_schema.sql"));
  const sec = read(join(ROOT, "supabase/migrations/0003_security_cron.sql"));
  const tables = [...schema.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
  assert.ok(tables.length >= 10);
  for (const t of tables) {
    assert.match(sec, new RegExp(`alter table public\\.${t}\\s+enable row level security`), `RLS not enabled for ${t}`);
  }
  assert.match(sec, /revoke all on all tables\s+in schema public from anon, authenticated/);
  assert.match(sec, /revoke all on all functions in schema public from public, anon, authenticated/);

  for (const f of ["0002_functions.sql", "0004_session_cap.sql", "0005_save_set_content.sql"]) {
    const text = read(join(ROOT, "supabase/migrations", f));
    const defs = text.split(/create or replace function /).slice(1);
    assert.ok(defs.length > 0);
    for (const d of defs) {
      const header = d.slice(0, d.indexOf("$$"));
      const name = header.slice(0, header.indexOf("(")).trim();
      assert.match(header, /security definer/, `${f}: ${name} is not SECURITY DEFINER`);
      assert.match(header, /set search_path = public, pg_temp/, `${f}: ${name} has no fixed search_path`);
    }
  }
});

test("every .rpc() call targets a function that exists in the migrations", () => {
  const sql = ["0002_functions.sql", "0004_session_cap.sql", "0005_save_set_content.sql"].map((f) => read(join(ROOT, "supabase/migrations", f))).join("\n");
  const defined = new Set([...sql.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]));
  for (const f of srcFiles) {
    for (const m of read(f).matchAll(/\.rpc\(\s*"(\w+)"/g)) {
      assert.ok(defined.has(m[1]), `${norm(f)} calls unknown rpc ${m[1]}`);
      assert.ok(!m[1].startsWith("_"), `${norm(f)} calls an internal function ${m[1]}`);
    }
  }
});
