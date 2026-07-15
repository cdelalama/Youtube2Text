import assert from "node:assert/strict";
import test from "node:test";
import { proxyToApi } from "../web/lib/apiProxy.js";
import { proxyPublicMediaStatus } from "../web/lib/publicStatusProxy.js";
import { isPublicPath } from "../web/middleware.js";
import {
  issueWebSessionToken,
  verifyOperatorPassphrase,
  verifyWebSessionToken,
  WEB_SESSION_COOKIE,
  isSameOriginRequest,
} from "../web/lib/webAuth.js";

const AUTH_SECRET = "test-web-auth-secret-that-is-long-enough";
const PASSPHRASE = "test-operator-passphrase";

async function withWebAuthEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previous = {
    secret: process.env.Y2T_WEB_AUTH_SECRET,
    passphrase: process.env.Y2T_WEB_AUTH_PASSPHRASE,
    hours: process.env.Y2T_WEB_AUTH_SESSION_HOURS,
    apiKey: process.env.Y2T_API_KEY,
    apiBaseUrl: process.env.Y2T_API_BASE_URL,
  };
  process.env.Y2T_WEB_AUTH_SECRET = AUTH_SECRET;
  process.env.Y2T_WEB_AUTH_PASSPHRASE = PASSPHRASE;
  process.env.Y2T_WEB_AUTH_SESSION_HOURS = "12";
  process.env.Y2T_API_KEY = "backend-api-key-for-tests";
  process.env.Y2T_API_BASE_URL = "http://api.test";
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries({
      Y2T_WEB_AUTH_SECRET: previous.secret,
      Y2T_WEB_AUTH_PASSPHRASE: previous.passphrase,
      Y2T_WEB_AUTH_SESSION_HOURS: previous.hours,
      Y2T_API_KEY: previous.apiKey,
      Y2T_API_BASE_URL: previous.apiBaseUrl,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("web sessions reject tampered and expired tokens", async () => {
  await withWebAuthEnv(async () => {
    const issuedAt = Date.UTC(2026, 6, 14);
    const token = await issueWebSessionToken(issuedAt);

    assert.equal(await verifyWebSessionToken(token, issuedAt + 1000), true);
    assert.equal(await verifyWebSessionToken(`${token.slice(0, -1)}x`, issuedAt + 1000), false);
    assert.equal(await verifyWebSessionToken(token, issuedAt + 13 * 60 * 60 * 1000), false);
  });
});

test("operator passphrase verification fails closed", async () => {
  await withWebAuthEnv(async () => {
    assert.equal(await verifyOperatorPassphrase(PASSPHRASE), true);
    assert.equal(await verifyOperatorPassphrase("incorrect-passphrase"), false);

    delete process.env.Y2T_WEB_AUTH_SECRET;
    assert.equal(await verifyOperatorPassphrase(PASSPHRASE), false);
  });
});

test("same-origin checks use the public forwarded origin and fail closed", () => {
  assert.equal(isSameOriginRequest(new Request("http://internal:3000/api/auth/login", {
    method: "POST",
    headers: {
      origin: "https://media.example.test",
      host: "internal:3000",
      "x-forwarded-host": "media.example.test",
      "x-forwarded-proto": "https",
    },
  })), true);
  assert.equal(isSameOriginRequest(new Request("http://internal:3000/api/auth/login", {
    method: "POST",
    headers: {
      origin: "https://attacker.example.test",
      host: "media.example.test",
      "x-forwarded-proto": "https",
    },
  })), false);
  assert.equal(isSameOriginRequest(new Request("http://media.example.test/api/auth/login", {
    method: "POST",
  })), false);
});

test("BFF rejects unauthenticated requests without contacting the API", async () => {
  await withWebAuthEnv(async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return Response.json({ unexpected: true });
    };
    try {
      const response = await proxyToApi(
        new Request("http://console.test/api/runs"),
        "/runs"
      );
      assert.equal(response.status, 401);
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("BFF injects the API key only after session verification", async () => {
  await withWebAuthEnv(async () => {
    const token = await issueWebSessionToken();
    const originalFetch = globalThis.fetch;
    let forwardedKey: string | null = null;
    globalThis.fetch = async (_input, init) => {
      forwardedKey = new Headers(init?.headers).get("x-api-key");
      return Response.json({ ok: true });
    };
    try {
      const response = await proxyToApi(
        new Request("http://console.test/api/runs", {
          headers: { cookie: `${WEB_SESSION_COOKIE}=${encodeURIComponent(token)}` },
        }),
        "/runs"
      );
      assert.equal(response.status, 200);
      assert.equal(forwardedKey, "backend-api-key-for-tests");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("only the sanitized media status route is public", () => {
  assert.equal(isPublicPath("/api/status/media-pipeline"), true);
  assert.equal(isPublicPath("/api/status/media-pipeline/private"), false);
  assert.equal(isPublicPath("/api/runs"), false);
});

test("public media status proxy forwards without operator credentials", async () => {
  await withWebAuthEnv(async () => {
    const originalFetch = globalThis.fetch;
    let forwardedUrl = "";
    let forwardedKey: string | null = null;
    globalThis.fetch = async (input, init) => {
      forwardedUrl = String(input);
      forwardedKey = new Headers(init?.headers).get("x-api-key");
      return Response.json({ condition: "ok" });
    };
    try {
      const response = await proxyPublicMediaStatus();
      assert.equal(response.status, 200);
      assert.equal(forwardedUrl, "http://api.test/status/media-pipeline");
      assert.equal(forwardedKey, null);
      assert.equal(response.headers.get("cache-control"), "no-store");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
