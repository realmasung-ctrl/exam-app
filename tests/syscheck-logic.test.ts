import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateRegion, evaluateLatency, evaluateAppUrl, parseAuthSettings, evaluateSignup, evaluateCronSecret, summarize,
} from "../lib/syscheck-logic.ts";

test("region check", () => {
  assert.equal(evaluateRegion("sin1").status, "ok");
  assert.equal(evaluateRegion("hkg1").status, "ok");
  assert.equal(evaluateRegion("iad1").status, "warn");
  assert.match(evaluateRegion("iad1").detail, /sin1/);
  assert.equal(evaluateRegion(undefined).status, "warn");
});

test("latency thresholds", () => {
  assert.equal(evaluateLatency(40).status, "ok");
  assert.equal(evaluateLatency(199.9).status, "ok");
  assert.equal(evaluateLatency(200).status, "warn");
  assert.equal(evaluateLatency(599).status, "warn");
  assert.equal(evaluateLatency(600).status, "fail");
});

test("app url check", () => {
  assert.equal(evaluateAppUrl("https://exam.vercel.app", "exam.vercel.app").status, "ok");
  assert.equal(evaluateAppUrl("https://exam.vercel.app/", "EXAM.vercel.app").status, "ok");
  assert.equal(evaluateAppUrl("https://old.vercel.app", "new.vercel.app").status, "warn");
  assert.equal(evaluateAppUrl("", "x.vercel.app").status, "warn");
  assert.equal(evaluateAppUrl(undefined, null).status, "warn");
  assert.equal(evaluateAppUrl("http://exam.vercel.app", "exam.vercel.app").status, "fail");
  assert.equal(evaluateAppUrl("exam.vercel.app", "exam.vercel.app").status, "fail");
  assert.equal(evaluateAppUrl("https://exam.vercel.app/admin", "exam.vercel.app").status, "fail");
});

test("sign-up check reads the public auth settings", () => {
  assert.equal(parseAuthSettings({ disable_signup: true, external: {} }), true);
  assert.equal(parseAuthSettings({ disable_signup: false }), false);
  assert.equal(parseAuthSettings({}), null);
  assert.equal(parseAuthSettings(null), null);
  assert.equal(parseAuthSettings("x"), null);
  assert.equal(evaluateSignup(true).status, "ok");
  assert.equal(evaluateSignup(false).status, "fail");
  assert.equal(evaluateSignup(null).status, "warn");
});

test("cron secret + summary", () => {
  assert.equal(evaluateCronSecret(true).status, "ok");
  assert.equal(evaluateCronSecret(false).status, "warn");
  assert.deepEqual(summarize([evaluateCronSecret(true), evaluateCronSecret(false), evaluateSignup(false)]), { ok: 1, warn: 1, fail: 1 });
});
