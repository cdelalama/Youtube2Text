import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sanitizeConfigOverrides } from "../src/api/sanitize.js";
import {
  loadUsagePolicyFromEnv,
  UsageLedger,
  UsageLimitExceededError,
  type UsagePolicy,
} from "../src/usage/index.js";

function policy(overrides: Partial<UsagePolicy> = {}): UsagePolicy {
  return {
    enforcement: "enforce",
    maxItemMinutes: 180,
    maxRunMinutes: 300,
    maxSourceMinutes24h: 600,
    maxTotalMinutes30d: 3000,
    maxTotalUsd30d: 25,
    ratesUsdPerHour: {
      assemblyai: 1,
      deepgram: 1,
      openai_whisper: 1,
    },
    ...overrides,
  };
}

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "y2t-usage-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    sourceId: "source-1",
    itemId: "item-1",
    provider: "deepgram" as const,
    audioSeconds: 300,
    ...overrides,
  };
}

test("usage policy defaults enforce conservative local caps", () => {
  const loaded = loadUsagePolicyFromEnv({});
  assert.equal(loaded.enforcement, "enforce");
  assert.equal(loaded.maxItemMinutes, 180);
  assert.equal(loaded.maxRunMinutes, 300);
  assert.equal(loaded.maxTotalUsd30d, 25);
  assert.equal(loaded.ratesUsdPerHour.deepgram, 0.552);
});

test("usage policy rejects malformed limits instead of disabling them", () => {
  assert.throws(
    () => loadUsagePolicyFromEnv({ Y2T_USAGE_MAX_RUN_MINUTES: "invalid" }),
    /must be a non-negative number/
  );
  assert.throws(
    () => loadUsagePolicyFromEnv({ Y2T_USAGE_ENFORCEMENT: "off" }),
    /must be enforce or track/
  );
});

test("usage reservations persist measured minutes and estimated cost", async () => {
  await withTempDir(async (dir) => {
    const now = new Date("2026-07-14T12:00:00Z");
    const ledger = new UsageLedger(dir, { policy: policy(), now: () => now });
    const reservation = await ledger.reserve(request());
    await ledger.finish(reservation.reservationId, "completed");

    const snapshot = await ledger.snapshot();
    assert.equal(snapshot.last30d.audioMinutes, 5);
    assert.equal(snapshot.last30d.estimatedUsd, 0.083333);
    assert.equal(snapshot.last30d.byProvider.find((row) => row.provider === "deepgram")?.reservations, 1);
    assert.equal(snapshot.pendingReservations, 0);
  });
});

test("batch reservations are atomic when a projected run exceeds its cap", async () => {
  await withTempDir(async (dir) => {
    const ledger = new UsageLedger(dir, {
      policy: policy({ maxRunMinutes: 10 }),
    });
    await assert.rejects(
      ledger.reserveBatch([
        request({ itemId: "a", audioSeconds: 360 }),
        request({ itemId: "b", audioSeconds: 300 }),
      ]),
      (error) => error instanceof UsageLimitExceededError
        && error.decision.violations.some((violation) => violation.scope === "run")
    );
    assert.equal((await ledger.snapshot()).last30d.reservations, 0);
  });
});

test("item duration is checked independently from split chunk duration", async () => {
  await withTempDir(async (dir) => {
    const ledger = new UsageLedger(dir, {
      policy: policy({ maxItemMinutes: 60 }),
    });
    await assert.rejects(
      ledger.reserveBatch([
        request({ audioSeconds: 1800, itemSeconds: 7200 }),
        request({ audioSeconds: 1800, itemSeconds: 7200 }),
      ]),
      (error) => error instanceof UsageLimitExceededError
        && error.decision.violations.some((violation) => violation.scope === "item")
    );
  });
});

test("released reservations do not consume budget", async () => {
  await withTempDir(async (dir) => {
    const ledger = new UsageLedger(dir, {
      policy: policy({ maxRunMinutes: 5 }),
    });
    const reservation = await ledger.reserve(request());
    await ledger.finish(reservation.reservationId, "released");
    await ledger.reserve(request({ itemId: "item-2" }));
    assert.equal((await ledger.snapshot()).last30d.reservations, 1);
  });
});

test("concurrent ledger instances cannot both cross the same total cap", async () => {
  await withTempDir(async (dir) => {
    const sharedPolicy = policy({ maxTotalMinutes30d: 10, maxRunMinutes: 0 });
    const first = new UsageLedger(dir, { policy: sharedPolicy });
    const second = new UsageLedger(dir, { policy: sharedPolicy });
    const results = await Promise.allSettled([
      first.reserve(request({ runId: "run-a", audioSeconds: 360 })),
      second.reserve(request({ runId: "run-b", audioSeconds: 360 })),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal((await first.snapshot()).last30d.audioMinutes, 6);
  });
});

test("estimates use the same policy without mutating the ledger", async () => {
  await withTempDir(async (dir) => {
    const ledger = new UsageLedger(dir, {
      policy: policy({ maxRunMinutes: 4 }),
    });
    const estimate = await ledger.estimate([request()], 0);
    assert.equal(estimate.allowed, false);
    assert.equal(estimate.violations[0]?.scope, "run");
    assert.equal((await ledger.snapshot()).last30d.reservations, 0);

    const incomplete = await ledger.estimate([], 2);
    assert.equal(incomplete.complete, false);
    assert.equal(incomplete.allowed, null);
  });
});

test("track mode records violations without blocking", async () => {
  await withTempDir(async (dir) => {
    const ledger = new UsageLedger(dir, {
      policy: policy({ enforcement: "track", maxRunMinutes: 1 }),
    });
    await ledger.reserve(request());
    assert.equal((await ledger.snapshot()).last30d.audioMinutes, 5);
  });
});

test("a corrupt ledger fails closed", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "_usage"), { recursive: true });
    await writeFile(join(dir, "_usage", "ledger.json"), "not-json", "utf8");
    const ledger = new UsageLedger(dir, { policy: policy() });
    await assert.rejects(ledger.reserve(request()), /Usage ledger unavailable/);
  });
});

test("a structurally invalid reservation fails closed", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "_usage"), { recursive: true });
    await writeFile(
      join(dir, "_usage", "ledger.json"),
      JSON.stringify({
        version: 1,
        updatedAt: "2026-07-14T12:00:00.000Z",
        reservations: [{ reservationId: "broken", audioSeconds: "NaN" }],
      }),
      "utf8"
    );
    const ledger = new UsageLedger(dir, { policy: policy() });
    await assert.rejects(ledger.snapshot(), /Usage ledger unavailable/);
  });
});

test("run config overrides cannot replace provider credentials", () => {
  const sanitized = sanitizeConfigOverrides({
    assemblyAiApiKey: "secret",
    assemblyAiApiKeys: ["secret"],
    deepgramApiKey: "secret",
    deepgramApiKeys: ["secret"],
    openaiApiKey: "secret",
    concurrency: 3,
  });
  assert.equal(sanitized.assemblyAiApiKey, undefined);
  assert.equal(sanitized.assemblyAiApiKeys, undefined);
  assert.equal(sanitized.deepgramApiKey, undefined);
  assert.equal(sanitized.deepgramApiKeys, undefined);
  assert.equal(sanitized.openaiApiKey, undefined);
  assert.equal(sanitized.concurrency, 3);
});
