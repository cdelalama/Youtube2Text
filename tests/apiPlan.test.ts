import test from "node:test";
import assert from "node:assert/strict";
import { planFromListing, selectCandidateVideos } from "../src/pipeline/plan.js";
import { isBeforeDate } from "../src/utils/date.js";

test("planFromListing counts processed vs remaining (force=false)", async () => {
  const plan = await planFromListing(
    "https://example.com/channel",
    {
      channelId: "C1",
      channelTitle: "Channel",
      videos: [
        { id: "a", title: "A", url: "u1", uploadDate: "20240101", durationSeconds: 125 },
        { id: "b", title: "B", url: "u2", uploadDate: "20240102" },
        { id: "c", title: "C", url: "u3", uploadDate: "20240103" },
      ],
    },
    {
      assemblyAiApiKey: "test",
      outputDir: "output",
      audioDir: "audio",
      filenameStyle: "title_id",
      audioFormat: "mp3",
      languageDetection: "auto",
      languageCode: "en_us",
      concurrency: 1,
      csvEnabled: false,
      assemblyAiCreditsCheck: "none",
      assemblyAiMinBalanceMinutes: 60,
      commentsEnabled: false,
      pollIntervalMs: 5000,
      maxPollMinutes: 60,
      downloadRetries: 0,
      transcriptionRetries: 0,
      ytDlpExtraArgs: [],
    },
    { force: false },
    { buildProcessedVideoIdSet: async () => new Set(["b"]) }
  );

  assert.equal(plan.totalVideos, 3);
  assert.equal(plan.alreadyProcessed, 1);
  assert.equal(plan.unprocessed, 2);
  assert.equal(plan.toProcess, 2);
  assert.equal(plan.videos.find((v) => v.id === "b")?.processed, true);
  assert.equal(plan.selectedVideos.find((v) => v.id === "a")?.durationSeconds, 125);
  assert.deepEqual(
    plan.selectedVideos.map((v) => v.id),
    ["a", "c"]
  );
});

test("planFromListing treats everything as unprocessed when force=true", async () => {
  const plan = await planFromListing(
    "https://example.com/channel",
    {
      channelId: "C1",
      channelTitle: "Channel",
      videos: [{ id: "a", title: "A", url: "u1", uploadDate: "20240101" }],
    },
    {
      assemblyAiApiKey: "test",
      outputDir: "output",
      audioDir: "audio",
      filenameStyle: "title_id",
      audioFormat: "mp3",
      languageDetection: "auto",
      languageCode: "en_us",
      concurrency: 1,
      csvEnabled: false,
      assemblyAiCreditsCheck: "none",
      assemblyAiMinBalanceMinutes: 60,
      commentsEnabled: false,
      pollIntervalMs: 5000,
      maxPollMinutes: 60,
      downloadRetries: 0,
      transcriptionRetries: 0,
      ytDlpExtraArgs: [],
    },
    { force: true },
    { buildProcessedVideoIdSet: async () => new Set(["a"]) }
  );

  assert.equal(plan.totalVideos, 1);
  assert.equal(plan.alreadyProcessed, 0);
  assert.equal(plan.unprocessed, 1);
  assert.equal(plan.toProcess, 1);
  assert.equal(plan.videos[0]?.processed, false);
  assert.equal(plan.selectedVideos[0]?.id, "a");
});

test("planFromListing maxNewVideos applies after skipping already processed", async () => {
  const plan = await planFromListing(
    "https://example.com/channel",
    {
      channelId: "C1",
      channelTitle: "Channel",
      videos: [
        { id: "a", title: "A", url: "u1", uploadDate: "20240101" },
        { id: "b", title: "B", url: "u2", uploadDate: "20240102" },
        { id: "c", title: "C", url: "u3", uploadDate: "20240103" },
        { id: "d", title: "D", url: "u4", uploadDate: "20240104" },
      ],
    },
    {
      assemblyAiApiKey: "test",
      outputDir: "output",
      audioDir: "audio",
      filenameStyle: "title_id",
      audioFormat: "mp3",
      languageDetection: "auto",
      languageCode: "en_us",
      concurrency: 1,
      maxNewVideos: 2,
      csvEnabled: false,
      assemblyAiCreditsCheck: "none",
      assemblyAiMinBalanceMinutes: 60,
      commentsEnabled: false,
      pollIntervalMs: 5000,
      maxPollMinutes: 60,
      downloadRetries: 0,
      transcriptionRetries: 0,
      ytDlpExtraArgs: [],
    },
    { force: false },
    {
      buildProcessedVideoIdSet: async () => new Set(["a", "b"]),
    }
  );

  assert.equal(plan.totalVideos, 4);
  assert.equal(plan.alreadyProcessed, 2);
  assert.equal(plan.unprocessed, 2);
  assert.equal(plan.toProcess, 2);
  assert.deepEqual(
    plan.selectedVideos.map((v) => v.id),
    ["c", "d"]
  );
});

test("isBeforeDate utility", () => {
  assert.equal(isBeforeDate("20240101", "2024-06-30"), true);
  assert.equal(isBeforeDate("20240701", "2024-06-30"), false);
  assert.equal(isBeforeDate("20240630", "2024-06-30"), true);
  assert.equal(isBeforeDate(undefined, "2024-06-30"), true);
  assert.equal(isBeforeDate("20240101", undefined), true);
});

test("planFromListing filters by beforeDate", async () => {
  const plan = await planFromListing(
    "https://example.com/channel",
    {
      channelId: "C1",
      channelTitle: "Channel",
      videos: [
        { id: "a", title: "A", url: "u1", uploadDate: "20240101" },
        { id: "b", title: "B", url: "u2", uploadDate: "20240601" },
        { id: "c", title: "C", url: "u3", uploadDate: "20241201" },
      ],
    },
    {
      assemblyAiApiKey: "test",
      outputDir: "output",
      audioDir: "audio",
      filenameStyle: "title_id",
      audioFormat: "mp3",
      languageDetection: "auto",
      languageCode: "en_us",
      concurrency: 1,
      csvEnabled: false,
      assemblyAiCreditsCheck: "none",
      assemblyAiMinBalanceMinutes: 60,
      commentsEnabled: false,
      pollIntervalMs: 5000,
      maxPollMinutes: 60,
      downloadRetries: 0,
      transcriptionRetries: 0,
      ytDlpExtraArgs: [],
      beforeDate: "2024-06-30",
    },
    { force: false },
    { buildProcessedVideoIdSet: async () => new Set() }
  );

  assert.equal(plan.totalVideos, 2);
  assert.deepEqual(plan.videos.map((v) => v.id), ["a", "b"]);
  assert.equal(plan.filters.beforeDate, "2024-06-30");
});

test("planFromListing filters by afterDate + beforeDate window", async () => {
  const plan = await planFromListing(
    "https://example.com/channel",
    {
      channelId: "C1",
      channelTitle: "Channel",
      videos: [
        { id: "a", title: "A", url: "u1", uploadDate: "20230601" },
        { id: "b", title: "B", url: "u2", uploadDate: "20240301" },
        { id: "c", title: "C", url: "u3", uploadDate: "20240901" },
        { id: "d", title: "D", url: "u4", uploadDate: "20250101" },
      ],
    },
    {
      assemblyAiApiKey: "test",
      outputDir: "output",
      audioDir: "audio",
      filenameStyle: "title_id",
      audioFormat: "mp3",
      languageDetection: "auto",
      languageCode: "en_us",
      concurrency: 1,
      csvEnabled: false,
      assemblyAiCreditsCheck: "none",
      assemblyAiMinBalanceMinutes: 60,
      commentsEnabled: false,
      pollIntervalMs: 5000,
      maxPollMinutes: 60,
      downloadRetries: 0,
      transcriptionRetries: 0,
      ytDlpExtraArgs: [],
      afterDate: "2024-01-01",
      beforeDate: "2024-12-31",
    },
    { force: false },
    { buildProcessedVideoIdSet: async () => new Set() }
  );

  assert.equal(plan.totalVideos, 2);
  assert.deepEqual(plan.videos.map((v) => v.id), ["b", "c"]);
});

test("planFromListing filters to videoIds and skips processedIndex", async () => {
  const plan = await planFromListing(
    "https://example.com/channel",
    {
      channelId: "C1",
      channelTitle: "Channel",
      videos: [
        { id: "a", title: "A", url: "u1", uploadDate: "20240101" },
        { id: "b", title: "B", url: "u2", uploadDate: "20240601" },
        { id: "c", title: "C", url: "u3", uploadDate: "20241201" },
      ],
    },
    {
      assemblyAiApiKey: "test",
      outputDir: "output",
      audioDir: "audio",
      filenameStyle: "title_id",
      audioFormat: "mp3",
      languageDetection: "auto",
      languageCode: "en_us",
      concurrency: 1,
      csvEnabled: false,
      assemblyAiCreditsCheck: "none",
      assemblyAiMinBalanceMinutes: 60,
      commentsEnabled: false,
      pollIntervalMs: 5000,
      maxPollMinutes: 60,
      downloadRetries: 0,
      transcriptionRetries: 0,
      ytDlpExtraArgs: [],
      videoIds: ["a", "c"],
    },
    { force: false },
    // Even though "a" is in the processedSet, videoIds should override
    { buildProcessedVideoIdSet: async () => new Set(["a"]) }
  );

  assert.equal(plan.totalVideos, 2);
  assert.equal(plan.alreadyProcessed, 0, "videoIds skips processedIndex");
  assert.equal(plan.toProcess, 2);
  assert.deepEqual(plan.videos.map((v) => v.id), ["a", "c"]);
  assert.deepEqual(plan.selectedVideos.map((v) => v.id), ["a", "c"]);
  assert.deepEqual(plan.filters.videoIds, ["a", "c"]);
  assert.equal(plan.filters.afterDate, undefined, "date filters are ignored with videoIds");
});

test("planFromListing with videoIds ignores IDs not in catalog", async () => {
  const plan = await planFromListing(
    "https://example.com/channel",
    {
      channelId: "C1",
      channelTitle: "Channel",
      videos: [
        { id: "a", title: "A", url: "u1" },
        { id: "b", title: "B", url: "u2" },
      ],
    },
    {
      assemblyAiApiKey: "test",
      outputDir: "output",
      audioDir: "audio",
      filenameStyle: "title_id",
      audioFormat: "mp3",
      languageDetection: "auto",
      languageCode: "en_us",
      concurrency: 1,
      csvEnabled: false,
      assemblyAiCreditsCheck: "none",
      assemblyAiMinBalanceMinutes: 60,
      commentsEnabled: false,
      pollIntervalMs: 5000,
      maxPollMinutes: 60,
      downloadRetries: 0,
      transcriptionRetries: 0,
      ytDlpExtraArgs: [],
      videoIds: ["a", "z_missing"],
    },
    { force: false },
    { buildProcessedVideoIdSet: async () => new Set() }
  );

  assert.equal(plan.totalVideos, 1, "only matching IDs");
  assert.deepEqual(plan.videos.map((v) => v.id), ["a"]);
});

test("selectCandidateVideos applies the same date window used by planFromListing", async () => {
  const listing = {
    channelId: "C1",
    channelTitle: "Channel",
    videos: [
      { id: "a", title: "A", url: "u1", uploadDate: "20230601" },
      { id: "b", title: "B", url: "u2", uploadDate: "20240301" },
      { id: "c", title: "C", url: "u3", uploadDate: "20240901" },
      { id: "d", title: "D", url: "u4", uploadDate: "20250101" },
    ],
  };
  const config = {
    assemblyAiApiKey: "test",
    outputDir: "output",
    audioDir: "audio",
    filenameStyle: "title_id",
    audioFormat: "mp3",
    languageDetection: "auto",
    languageCode: "en_us",
    concurrency: 1,
    csvEnabled: false,
    assemblyAiCreditsCheck: "none",
    assemblyAiMinBalanceMinutes: 60,
    commentsEnabled: false,
    pollIntervalMs: 5000,
    maxPollMinutes: 60,
    downloadRetries: 0,
    transcriptionRetries: 0,
    ytDlpExtraArgs: [],
    afterDate: "2024-01-01",
    beforeDate: "2024-12-31",
  } as const;

  const selection = await selectCandidateVideos(
    listing,
    config,
    { force: false },
    { buildProcessedVideoIdSet: async () => new Set(["b"]) }
  );
  const plan = await planFromListing(
    "https://example.com/channel",
    listing,
    config,
    { force: false },
    { buildProcessedVideoIdSet: async () => new Set(["b"]) }
  );

  assert.deepEqual(selection.candidates.map((v) => v.video.id), ["b", "c"]);
  assert.deepEqual(selection.selectedCandidates.map((v) => v.video.id), ["c"]);
  assert.deepEqual(plan.selectedVideos.map((v) => v.id), ["c"]);
});
