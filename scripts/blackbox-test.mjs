#!/usr/bin/env node
// Black-box security + load test against a DEPLOYED copy of the app (needs Node 20+; no packages).
//
//   BASE_URL=https://your-app.vercel.app CODE=<16-hex code of a TEST session> node scripts/blackbox-test.mjs
//
// Optional environment variables
//   SENTINEL=<text>        a distinctive sentence you typed as an answer explanation in the test set;
//                          the script verifies it never appears in the exam page or (when hidden) the result page
//   EXPECT_REVEAL=hidden   set when the test session's answer display is "ไม่แสดงเฉลย" (enables the result-page leak check)
//   SESSION_ID=<uuid>      id of the test session (enables the admin-export-without-login check)
//   SUPABASE_URL / SUPABASE_ANON_KEY   enables the database lock-down checks with the PUBLIC key
//   --load N               also run N students at once (default 0).  Example: --load 50
//
// Use a throw-away session: duration >= 10 min, 3+ questions, status "open".  Every run leaves test participants
// behind (names start with "bbtest"); delete the session afterwards.
const BASE = (process.env.BASE_URL ?? "").replace(/\/+$/, "");
const CODE = process.env.CODE ?? "";
const SENTINEL = process.env.SENTINEL ?? "";
const HIDDEN = process.env.EXPECT_REVEAL === "hidden";
const SESSION_ID = process.env.SESSION_ID ?? "";
const SUPA = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const loadIdx = process.argv.indexOf("--load");
const LOAD = loadIdx > -1 ? Number(process.argv[loadIdx + 1] ?? 0) : 0;

if (!/^https?:\/\//.test(BASE) || !/^[0-9a-f]{16}$/.test(CODE)) {
  console.error("Set BASE_URL (https://...) and CODE (16 hex characters, the part after /e/ in the student link).");
  process.exit(2);
}

const RUN = Date.now().toString(36);
let passed = 0, failed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ❌ ${name}${detail ? `  -> ${detail}` : ""}`); }
}
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

async function http(path, { method = "GET", cookie, json, headers = {}, redirect = "manual" } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  let body;
  if (json !== undefined) { h["Content-Type"] = "application/json"; body = typeof json === "string" ? json : JSON.stringify(json); }
  const t0 = performance.now();
  const res = await fetch(path.startsWith("http") ? path : BASE + path, { method, headers: h, body, redirect });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, text, data, headers: res.headers, ms: performance.now() - t0 };
}
const isRedirect = (r, to) => [301, 302, 303, 307, 308].includes(r.status) && (r.headers.get("location") ?? "").includes(to);

function cookieFrom(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const raw = list.find((c) => c.startsWith(`et_${CODE}=`));
  return { header: raw ?? "", pair: raw ? raw.split(";")[0] : "" };
}
async function startStudent(first, last, code = "") {
  const r = await http(`/api/exam/${CODE}/start`, { method: "POST", json: { first_name: first, last_name: last, student_code: code } });
  return { r, ...cookieFrom(r) };
}
const answer = (cookie, q, label, seq, extra = {}) =>
  http(`/api/exam/${CODE}/answer`, { method: "PUT", cookie, json: { question_id: q, label, seq }, ...extra });

async function questionIds(cookie) {
  const page = await http(`/e/${CODE}/take`, { cookie });
  const ids = [...new Set(page.text.match(UUID_RE) ?? [])];
  return { page, ids };
}

async function main() {
  console.log(`Target: ${BASE}  session code: ${CODE}`);

  // ------------------------------------------------------------------ 1. nobody logged in
  section("1) Visitors without a login");
  for (const p of ["/admin", "/admin/sets", "/admin/sessions", "/admin/results", "/admin/settings"]) {
    const r = await http(p);
    check(`${p} redirects to the login page`, isRedirect(r, "/admin/login"), `status ${r.status}`);
  }
  const login = await http("/admin/login");
  check("login page is reachable", login.status === 200);
  const exp = await http(`/api/admin/sessions/${SESSION_ID || "00000000-0000-4000-8000-000000000000"}/export?format=csv`);
  check("admin CSV export without login -> 401", exp.status === 401, `status ${exp.status}`);
  const exp2 = await http(`/api/admin/sessions/${SESSION_ID || "00000000-0000-4000-8000-000000000000"}/export?format=xlsx`);
  check("admin Excel export without login -> 401", exp2.status === 401, `status ${exp2.status}`);
  const bad = await http("/e/0000000000000000");
  check("unknown exam code shows 'not found' (no crash)", bad.status === 200 && bad.text.includes("ไม่พบรอบสอบ"), `status ${bad.status}`);
  const junk = await http("/e/not-a-code");
  check("malformed exam code shows 'not found'", junk.status === 200 && junk.text.includes("ไม่พบรอบสอบ"), `status ${junk.status}`);

  section("2) Student endpoints without an exam token");
  check("state -> 401", (await http(`/api/exam/${CODE}/state`)).status === 401);
  check("answer -> 401", (await answer("", "00000000-0000-4000-8000-000000000000", "ก", 1)).status === 401);
  check("submit -> 401", (await http(`/api/exam/${CODE}/submit`, { method: "POST" })).status === 401);
  check("exam page redirects to the join page", isRedirect(await http(`/e/${CODE}/take`), `/e/${CODE}`));
  check("result page redirects to the join page", isRedirect(await http(`/e/${CODE}/result`), `/e/${CODE}`));
  const forged = await http(`/api/exam/${CODE}/state`, { cookie: `et_${CODE}=${"A".repeat(43)}` });
  check("a forged token is rejected", forged.status === 401, `status ${forged.status}`);

  section("3) Starting an exam");
  check("empty name -> 400", (await http(`/api/exam/${CODE}/start`, { method: "POST", json: { first_name: "", last_name: " " } })).status === 400);
  check("garbage body -> 400", (await http(`/api/exam/${CODE}/start`, { method: "POST", json: "{not json" })).status === 400);
  check("over-long name -> 400", (await startStudent("x".repeat(101), "y")).r.status === 400);
  const crossStart = await http(`/api/exam/${CODE}/start`, { method: "POST", json: { first_name: "evil", last_name: "site" }, headers: { Origin: "https://evil.example" } });
  check("start from another website's origin -> 403", crossStart.status === 403, `status ${crossStart.status}`);

  const A = await startStudent(`bbtest${RUN}`, "Alpha");
  check("valid start -> 200 + token cookie", A.r.status === 200 && A.pair !== "", `status ${A.r.status} ${JSON.stringify(A.r.data)}`);
  check("cookie is HttpOnly", /httponly/i.test(A.header));
  check("cookie is SameSite=Lax", /samesite=lax/i.test(A.header));
  if (BASE.startsWith("https://")) check("cookie is Secure", /;\s*secure/i.test(A.header));
  if (!A.pair) { console.log("\nCannot continue without a started attempt (is the session open?)."); return; }

  const dup = await startStudent(`  BBTEST${RUN} `, "alpha");
  check("same name (other case/spacing) cannot start a second attempt -> 409", dup.r.status === 409, `status ${dup.r.status}`);
  const stateA0 = await http(`/api/exam/${CODE}/state`, { cookie: A.pair });
  check("duplicate start did not reset the first attempt's clock", stateA0.status === 200 && stateA0.data?.status === "in_progress");

  section("4) The exam page and the answer key");
  const { page, ids } = await questionIds(A.pair);
  check("exam page loads", page.status === 200);
  check("exam page found question ids", ids.length >= 1, `found ${ids.length}`);
  check("exam page contains no 'is_correct'", !/is_correct/.test(page.text));
  if (SENTINEL) check("exam page does not contain the explanation text", !page.text.includes(SENTINEL));
  const q1 = ids[0], q2 = ids[1] ?? ids[0];

  section("5) Saving answers");
  const ok1 = await answer(A.pair, q1, "ข", 2000);
  check("valid answer saved", ok1.status === 200 && ok1.data?.ok === true, `status ${ok1.status}`);
  check("older retry (lower seq) is accepted but ignored", (await answer(A.pair, q1, "ค", 1000)).status === 200);
  const s1 = await http(`/api/exam/${CODE}/state`, { cookie: A.pair });
  check("...and the newer answer (ข) is the one stored", s1.data?.answers?.[q1] === "ข", JSON.stringify(s1.data?.answers));
  check("clock is running (deadline in the future)", Date.parse(s1.data?.deadline_at) > Date.parse(s1.data?.server_now));
  check("invalid label -> 400", (await answer(A.pair, q1, "จ", 1)).status === 400);
  check("non-uuid question -> 400", (await answer(A.pair, "../../etc/passwd", "ก", 1)).status === 400);
  check("negative seq -> 400", (await answer(A.pair, q1, "ก", -1)).status === 400);
  check("fractional seq -> 400", (await answer(A.pair, q1, "ก", 1.5)).status === 400);
  check("string seq -> 400", (await answer(A.pair, q1, "ก", "9")).status === 400);
  check("unknown question id -> 400", (await answer(A.pair, "11111111-1111-4111-8111-111111111111", "ก", 5)).status === 400);
  check("garbage body -> 400", (await http(`/api/exam/${CODE}/answer`, { method: "PUT", cookie: A.pair, json: "{oops" })).status === 400);
  const xo = await answer(A.pair, q1, "ก", 3000, { headers: { Origin: "https://evil.example" } });
  check("answer from another website's origin -> 403", xo.status === 403, `status ${xo.status}`);
  const afterXo = await http(`/api/exam/${CODE}/state`, { cookie: A.pair });
  check("...and it changed nothing", afterXo.data?.answers?.[q1] === "ข");
  const tryOther = await http(`/api/exam/${CODE}/answer?participant=1&token=x`, { method: "PUT", cookie: A.pair, json: { question_id: q1, label: "ก", seq: 3500, participant_id: "11111111-1111-4111-8111-111111111111" } });
  check("extra identity fields in the request are ignored (still saves for the cookie owner only)", tryOther.status === 200);
  if (q2 !== q1) await answer(A.pair, q2, "ก", 2001);

  section("6) Before and after submitting");
  check("result page before submitting sends the student back to the exam", isRedirect(await http(`/e/${CODE}/result`, { cookie: A.pair }), `/e/${CODE}/take`));
  const sub = await http(`/api/exam/${CODE}/submit`, { method: "POST", cookie: A.pair });
  check("submit -> 200", sub.status === 200 && sub.data?.ok === true, `status ${sub.status}`);
  const sub2 = await http(`/api/exam/${CODE}/submit`, { method: "POST", cookie: A.pair });
  check("submit twice is harmless and gives the same status", sub2.status === 200 && sub2.data?.status === sub.data?.status);
  const late = await answer(A.pair, q1, "ก", 9000);
  check("answer after submitting -> 409", late.status === 409 && late.data?.code === "ALREADY_SUBMITTED", `status ${late.status} ${JSON.stringify(late.data)}`);
  const sAfter = await http(`/api/exam/${CODE}/state`, { cookie: A.pair });
  check("state after submit reports it is finished", sAfter.status === 200 && sAfter.data?.status !== "in_progress");
  const resA = await http(`/e/${CODE}/result`, { cookie: A.pair });
  check("result page shows the student's own result", resA.status === 200 && resA.text.includes(`bbtest${RUN}`) && resA.text.includes("ส่งข้อสอบเรียบร้อยแล้ว"));
  if (HIDDEN && SENTINEL) check("result page hides the explanation while answers are hidden", !resA.text.includes(SENTINEL));
  const redo = await startStudent(`bbtest${RUN}`, "Alpha");
  check("finished student cannot start again -> 409", redo.r.status === 409, `status ${redo.r.status}`);
  const joinAgain = await http(`/e/${CODE}`, { cookie: A.pair });
  check("opening the link again sends a finished student to the result", isRedirect(joinAgain, `/e/${CODE}/result`));

  section("7) Students cannot see each other");
  const B = await startStudent(`bbtest${RUN}`, "Bravo");
  check("second student started", B.r.status === 200);
  const resB = await http(`/e/${CODE}/take`, { cookie: B.pair });
  check("B's exam page shows B, never A", resB.text.includes("Bravo") && !resB.text.includes("Alpha"));
  const forged2 = await http(`/api/exam/${CODE}/state`, { cookie: `et_${CODE}=${"A".repeat(43)}` });
  check("a forged token is still rejected now that real attempts exist", forged2.status === 401, `status ${forged2.status}`);
  const swapped = await http(`/api/exam/${CODE}/state`, { cookie: A.pair });
  check("A's token still only sees A's own (finished) attempt", swapped.data?.status !== "in_progress");
  await http(`/api/exam/${CODE}/submit`, { method: "POST", cookie: B.pair });
  const resB2 = await http(`/e/${CODE}/result`, { cookie: B.pair });
  check("B's result page shows B, never A", resB2.text.includes("Bravo") && !resB2.text.includes("Alpha"));

  // ------------------------------------------------------------------ database with the public key
  if (SUPA && ANON) {
    section("8) Database reached directly with the PUBLIC key (what an attacker can do from the browser)");
    const rest = (path, init = {}) => fetch(`${SUPA}${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
    for (const table of ["exam_sessions", "session_choices", "exam_participants", "participant_answers", "exam_results", "admin_profiles", "question_sets", "answer_choices"]) {
      const r = await rest(`/rest/v1/${table}?select=*&limit=1`);
      const body = await r.text();
      check(`reading ${table} returns nothing`, r.status >= 400 || body.trim() === "[]", `status ${r.status} body ${body.slice(0, 80)}`);
    }
    const w = await rest("/rest/v1/exam_results", { method: "POST", body: JSON.stringify({ participant_id: "11111111-1111-4111-8111-111111111111", score: 999 }) });
    check("writing a score directly is refused", w.status >= 400, `status ${w.status}`);
    const f = await rest("/rest/v1/rpc/finalize_expired", { method: "POST", body: "{}" });
    check("calling a database function directly is refused", f.status >= 400, `status ${f.status}`);
    const s = await rest("/rest/v1/rpc/save_answer", { method: "POST", body: JSON.stringify({ p_token_hash: "x".repeat(64), p_session_question_id: q1, p_choice_label: "ก", p_client_seq: 1 }) });
    check("calling save_answer directly is refused", s.status >= 400, `status ${s.status}`);
    const su = await fetch(`${SUPA}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: `bbtest-${RUN}@example.com`, password: `Bb-${RUN}-Test-12345` }) });
    check("public sign-up is switched off", su.status >= 400, `status ${su.status} — if this FAILED, turn off 'Allow new users to sign up' and delete the user bbtest-${RUN}@example.com in Authentication > Users`);
  } else {
    section("8) Database lock-down checks skipped (set SUPABASE_URL and SUPABASE_ANON_KEY to enable)");
  }

  // ------------------------------------------------------------------ load
  if (LOAD > 0) {
    section(`9) Load: ${LOAD} students at the same time`);
    const lat = [];
    const results = await Promise.all(Array.from({ length: LOAD }, async (_, i) => {
      const name = `bbtest${RUN}`; const last = `Load${String(i).padStart(3, "0")}`;
      try {
        await sleep(Math.random() * 1500);
        const s = await startStudent(name, last);
        lat.push(s.r.ms);
        if (s.r.status !== 200) return { ok: false, why: `start ${s.r.status}` };
        const { ids } = await questionIds(s.pair);
        if (ids.length === 0) return { ok: false, why: "no questions" };
        for (const q of ids) {
          await sleep(Math.random() * 300);
          const a = await answer(s.pair, q, ["ก", "ข", "ค", "ง"][Math.floor(Math.random() * 4)], Date.now());
          lat.push(a.ms);
          if (a.status !== 200) return { ok: false, why: `answer ${a.status}` };
        }
        const sb = await http(`/api/exam/${CODE}/submit`, { method: "POST", cookie: s.pair });
        lat.push(sb.ms);
        if (sb.status !== 200) return { ok: false, why: `submit ${sb.status}` };
        const rp = await http(`/e/${CODE}/result`, { cookie: s.pair });
        if (rp.status !== 200 || !rp.text.includes(last)) return { ok: false, why: "result page wrong" };
        return { ok: true };
      } catch (e) { return { ok: false, why: String(e.message ?? e) }; }
    }));
    const okCount = results.filter((r) => r.ok).length;
    check(`all ${LOAD} students completed start -> answer -> submit -> result`, okCount === LOAD, `${okCount}/${LOAD}; first problems: ${[...new Set(results.filter((r) => !r.ok).map((r) => r.why))].slice(0, 3).join("; ")}`);
    lat.sort((a, b) => a - b);
    const p = (q) => Math.round(lat[Math.min(lat.length - 1, Math.floor(lat.length * q))] ?? 0);
    console.log(`  ℹ️  requests: ${lat.length}   median ${p(0.5)} ms   95th percentile ${p(0.95)} ms   slowest ${p(1)} ms`);
    check("95th percentile response time under 3 seconds", p(0.95) < 3000, `${p(0.95)} ms`);
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log("Failed checks:\n - " + failures.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error("Test run crashed:", e); process.exit(2); });
