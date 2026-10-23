import assert from "node:assert/strict";
import test from "node:test";
import { waitFor, requireLoginRedirect } from "../scripts/verify-deployment-helpers.mjs";

const canonical = "https://y2t.lamanoriega.com";
test("login redirect accepts relative and absolute canonical destinations", () => {
  for (const location of ["/login?next=%2F", `${canonical}/login?next=%2F`]) {
    assert.doesNotThrow(() => requireLoginRedirect(location, canonical));
  }
});
test("login redirect rejects foreign origins, lookalike paths and missing locations", () => {
  for (const location of [null, "", "https://example.com/login", "//example.com/login",
    "http://y2t.lamanoriega.com/login", "/login-elsewhere", "/login/", "/", "https://user@y2t.lamanoriega.com/login"]) {
    assert.throws(() => requireLoginRedirect(location, canonical));
  }
});
test("readiness recovers from transient startup failures", async () => {
  let attempts = 0;
  const result = await waitFor("public status", async () => {
    if (++attempts < 3) throw new Error("HTTP 502");
    return { condition: "degraded", observed_at: "2026-10-23T23:17:19Z" };
  }, 500, 1);
  assert.equal(attempts, 3);
  assert.equal(result.condition, "degraded");
});
test("readiness remains bounded and preserves the failure reason", async () => {
  await assert.rejects(waitFor("public status", async () => {
    throw new Error("HTTP 502");
  }, 15, 1), /public status did not become ready: HTTP 502/);
});
