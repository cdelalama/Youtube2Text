"use client";

import { useEffect, useMemo, useState } from "react";
import type { components } from "../../lib/apiTypes.gen";

type SettingsGetResponse = components["schemas"]["SettingsGetResponse"];
type Sources = SettingsGetResponse["sources"];

type TriBool = "" | "true" | "false";
type FilenameStyleOpt = "" | "id" | "id_title" | "title_id";
type AudioFormatOpt = "" | "mp3" | "wav";
type SttProviderOpt = "" | "assemblyai" | "deepgram" | "openai_whisper";
type LanguageDetectionOpt = "" | "auto" | "manual";

function Tooltip({ text, effective }: { text: string; effective?: string }) {
  const [open, setOpen] = useState(false);
  const fullText = effective ? `${text}\n\nCurrent: ${effective}` : text;
  return (
    <span className="tooltipContainer" data-open={open ? "true" : "false"}>
      <span
        className="tooltipIcon"
        role="button"
        tabIndex={0}
        aria-label={fullText}
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        onBlur={() => setOpen(false)}
      >
        ?
      </span>
      <span className="tooltipText" style={{ whiteSpace: "pre-line" }}>{fullText}</span>
    </span>
  );
}

function fmtEffective(value: unknown): string {
  if (value === undefined) return "(unset)";
  if (value === null) return "(unset)";
  if (typeof value === "string") return value.trim().length === 0 ? "(unset)" : value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "(empty)" : `${value.length} items`;
  return String(value);
}

function toTriBool(v: unknown): TriBool {
  if (v === true) return "true";
  if (v === false) return "false";
  return "";
}

function parseTriBool(v: TriBool): boolean | null {
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function parseOptionalInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return NaN;
  return n;
}

function fmtSource(source: unknown): string {
  if (source === "env") return "env";
  if (source === "config.yaml") return "config.yaml";
  if (source === "settingsFile") return "settings file";
  if (source === "default") return "default";
  if (source === "unset") return "unset";
  return "unknown";
}

export function SettingsForm({ initial }: { initial: SettingsGetResponse }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [data, setData] = useState<SettingsGetResponse>(initial);
  const [providers, setProviders] = useState<
    components["schemas"]["ProviderCapability"][] | undefined
  >(undefined);

  const initialForm = useMemo(() => {
    const s = data.settings ?? {};
    const filenameStyle: FilenameStyleOpt =
      s.filenameStyle === "id" || s.filenameStyle === "id_title" || s.filenameStyle === "title_id"
        ? s.filenameStyle
        : "";
    const audioFormat: AudioFormatOpt =
      s.audioFormat === "mp3" || s.audioFormat === "wav" ? s.audioFormat : "";
    const sttProvider: SttProviderOpt =
      s.sttProvider === "assemblyai" || s.sttProvider === "deepgram" || s.sttProvider === "openai_whisper"
        ? s.sttProvider
        : "";
    const languageDetection: LanguageDetectionOpt =
      s.languageDetection === "auto" || s.languageDetection === "manual" ? s.languageDetection : "";
    return {
      filenameStyle,
      audioFormat,
      sttProvider,
      deepgramModel: (s.deepgramModel as string | undefined) ?? "",
      deepgramDiarization: toTriBool(s.deepgramDiarization),
      openaiWhisperModel: (s.openaiWhisperModel as string | undefined) ?? "",
      maxAudioMB: s.maxAudioMB === undefined ? "" : String(s.maxAudioMB),
      splitOverlapSeconds:
        s.splitOverlapSeconds === undefined ? "" : String(s.splitOverlapSeconds),
      languageDetection,
      languageCode: (s.languageCode as string | undefined) ?? "",
      concurrency: s.concurrency === undefined ? "" : String(s.concurrency),
      maxNewVideos: s.maxNewVideos === undefined ? "" : String(s.maxNewVideos),
      afterDate: (s.afterDate as string | undefined) ?? "",
      csvEnabled: toTriBool(s.csvEnabled),
      commentsEnabled: toTriBool(s.commentsEnabled),
      commentsMax: s.commentsMax === undefined ? "" : String(s.commentsMax),
      pollIntervalMs: s.pollIntervalMs === undefined ? "" : String(s.pollIntervalMs),
      maxPollMinutes: s.maxPollMinutes === undefined ? "" : String(s.maxPollMinutes),
      downloadRetries: s.downloadRetries === undefined ? "" : String(s.downloadRetries),
      transcriptionRetries:
        s.transcriptionRetries === undefined ? "" : String(s.transcriptionRetries),
      providerTimeoutMs:
        s.providerTimeoutMs === undefined ? "" : String(s.providerTimeoutMs),
      catalogMaxAgeHours: s.catalogMaxAgeHours === undefined ? "" : String(s.catalogMaxAgeHours),
    };
  }, [data.settings]);

  const [form, setForm] = useState(initialForm);

  // When server updates `data.settings` (after a save), reset the form.
  useEffect(() => {
    setForm(initialForm);
  }, [initialForm]);

  const effective = data.effective ?? ({} as any);
  const sources: Sources = (data.sources ?? {}) as any;

  const effectiveProvider =
    form.sttProvider !== "" ? form.sttProvider : (effective.sttProvider as string);
  const providerLimitMb = useMemo(() => {
    const match = providers?.find((p) => p.id === effectiveProvider);
    if (!match || typeof match.maxAudioBytes !== "number") return undefined;
    return Math.round(match.maxAudioBytes / (1024 * 1024));
  }, [providers, effectiveProvider]);
  const effectiveMaxAudioMb = useMemo(() => {
    const raw = form.maxAudioMB.trim();
    const input = raw.length > 0 ? Number(raw) : undefined;
    const userLimit = Number.isFinite(input) ? input : undefined;
    if (providerLimitMb !== undefined && userLimit !== undefined) {
      return Math.min(providerLimitMb, userLimit);
    }
    return providerLimitMb ?? userLimit;
  }, [form.maxAudioMB, providerLimitMb]);

  useEffect(() => {
    let cancelled = false;
    async function loadProviders() {
      try {
        const res = await fetch("/api/providers");
        if (!res.ok) return;
        const json = (await res.json()) as { providers?: components["schemas"]["ProviderCapability"][] };
        if (!cancelled) setProviders(json.providers);
      } catch {
        // ignore
      }
    }
    loadProviders();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      const concurrency = parseOptionalInt(form.concurrency);
      const maxNewVideos = parseOptionalInt(form.maxNewVideos);
      const commentsMax = parseOptionalInt(form.commentsMax);
      const pollIntervalMs = parseOptionalInt(form.pollIntervalMs);
      const maxPollMinutes = parseOptionalInt(form.maxPollMinutes);
      const downloadRetries = parseOptionalInt(form.downloadRetries);
      const transcriptionRetries = parseOptionalInt(form.transcriptionRetries);
      const providerTimeoutMs = parseOptionalInt(form.providerTimeoutMs);
      const catalogMaxAgeHours = parseOptionalInt(form.catalogMaxAgeHours);
      const maxAudioMB = parseOptionalInt(form.maxAudioMB);
      const splitOverlapSeconds = parseOptionalInt(form.splitOverlapSeconds);

      const badNums = [
        ["concurrency", concurrency],
        ["maxNewVideos", maxNewVideos],
        ["commentsMax", commentsMax],
        ["pollIntervalMs", pollIntervalMs],
        ["maxPollMinutes", maxPollMinutes],
        ["downloadRetries", downloadRetries],
        ["transcriptionRetries", transcriptionRetries],
        ["providerTimeoutMs", providerTimeoutMs],
        ["catalogMaxAgeHours", catalogMaxAgeHours],
        ["maxAudioMB", maxAudioMB],
        ["splitOverlapSeconds", splitOverlapSeconds],
      ].filter(([, v]) => typeof v === "number" && Number.isNaN(v));
      if (badNums.length > 0) {
        setError(`Invalid number: ${badNums.map(([k]) => k).join(", ")}`);
        return;
      }

      const payload: components["schemas"]["SettingsPatchRequest"] = {
        settings: {
          filenameStyle: form.filenameStyle === "" ? null : form.filenameStyle,
          audioFormat: form.audioFormat === "" ? null : form.audioFormat,
          sttProvider: form.sttProvider === "" ? null : form.sttProvider,
          deepgramModel:
            form.deepgramModel.trim().length === 0
              ? null
              : form.deepgramModel.trim(),
          deepgramDiarization: parseTriBool(form.deepgramDiarization),
          openaiWhisperModel:
            form.openaiWhisperModel.trim().length === 0
              ? null
              : form.openaiWhisperModel.trim(),
          maxAudioMB: maxAudioMB === null ? null : maxAudioMB,
          splitOverlapSeconds: splitOverlapSeconds === null ? null : splitOverlapSeconds,
          languageDetection: form.languageDetection === "" ? null : form.languageDetection,
          languageCode: form.languageCode.trim().length === 0 ? null : form.languageCode.trim(),
          concurrency: concurrency === null ? null : concurrency,
          maxNewVideos: maxNewVideos === null ? null : maxNewVideos,
          afterDate: form.afterDate.trim().length === 0 ? null : form.afterDate.trim(),
          csvEnabled: parseTriBool(form.csvEnabled),
          commentsEnabled: parseTriBool(form.commentsEnabled),
          commentsMax: commentsMax === null ? null : commentsMax,
          pollIntervalMs: pollIntervalMs === null ? null : pollIntervalMs,
          maxPollMinutes: maxPollMinutes === null ? null : maxPollMinutes,
          downloadRetries: downloadRetries === null ? null : downloadRetries,
          transcriptionRetries: transcriptionRetries === null ? null : transcriptionRetries,
          providerTimeoutMs: providerTimeoutMs === null ? null : providerTimeoutMs,
          catalogMaxAgeHours: catalogMaxAgeHours === null ? null : catalogMaxAgeHours,
        },
      };

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`PATCH /settings failed: ${res.status} ${text}`);
      }
      const json = (await res.json()) as SettingsGetResponse;
      setData(json);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="row">
          <h2 className="title">Settings</h2>
          <span className="pill">non-secret</span>
        </div>
        <p className="m0 muted break">
          Stored at <span className="mono">{data.settingsPath}</span>
          {data.updatedAt ? (
            <>
              {" "}
              <span className="pill">updated</span> <span className="mono">{data.updatedAt}</span>
            </>
          ) : null}
        </p>
        <div className="spacer14" />

        {error ? <p className="m0 textBad break">{error}</p> : null}

        <div className="spacer10" />

        <div className="flexWrap">
          <button className="button" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save settings"}
          </button>
        </div>

        <div className="spacer14" />

        <div className="grid">
          <div className="card">
            <h3 className="title">Core</h3>
            <div className="stackTight">
              <div className="formRow">
                <span className="formLabel">
                  filenameStyle
                  <Tooltip
                    text="Output filename format: title_id (Title__abc123), id_title, or id only."
                    effective={form.filenameStyle === "" ? `${fmtEffective(effective.filenameStyle)} (${fmtSource(sources.filenameStyle)})` : undefined}
                  />
                </span>
                <select
                  className="inputMd"
                  value={form.filenameStyle}
                  onChange={(e) =>
                    setForm({ ...form, filenameStyle: e.target.value as FilenameStyleOpt })
                  }
                >
                  <option value="">(inherit)</option>
                  <option value="title_id">title_id</option>
                  <option value="id_title">id_title</option>
                  <option value="id">id</option>
                </select>
                {form.filenameStyle === "" && <span className="muted effectiveHint">{fmtEffective(effective.filenameStyle)}</span>}
              </div>

              <div className="formRow">
                <span className="formLabel">
                  audioFormat
                  <Tooltip
                    text="Downloaded audio format: mp3 (smaller) or wav (lossless, bigger files)."
                    effective={form.audioFormat === "" ? `${fmtEffective(effective.audioFormat)} (${fmtSource(sources.audioFormat)})` : undefined}
                  />
                </span>
                <select
                  className="inputMd"
                  value={form.audioFormat}
                  onChange={(e) =>
                    setForm({ ...form, audioFormat: e.target.value as AudioFormatOpt })
                  }
                >
                  <option value="">(inherit)</option>
                  <option value="mp3">mp3</option>
                  <option value="wav">wav</option>
                </select>
                {form.audioFormat === "" && <span className="muted effectiveHint">{fmtEffective(effective.audioFormat)}</span>}
              </div>

              <div className="formRow">
                <span className="formLabel">
                  sttProvider
                  <Tooltip
                    text="Select the speech-to-text provider. Default is AssemblyAI."
                    effective={form.sttProvider === "" ? `${fmtEffective(effective.sttProvider)} (${fmtSource(sources.sttProvider)})` : undefined}
                  />
                </span>
                <select
                  className="inputMd"
                  value={form.sttProvider}
                  onChange={(e) =>
                    setForm({ ...form, sttProvider: e.target.value as SttProviderOpt })
                  }
                >
                  <option value="">(inherit)</option>
                  <option value="assemblyai">assemblyai</option>
                  <option value="deepgram">deepgram</option>
                  <option value="openai_whisper">openai_whisper</option>
                </select>
                {form.sttProvider === "" && <span className="muted effectiveHint">{fmtEffective(effective.sttProvider)}</span>}
              </div>

              <div className="formRow">
                <span className="formLabel">
                  deepgramModel
                  <Tooltip
                    text="Deepgram model name (default nova-3)."
                    effective={form.deepgramModel.trim().length === 0 ? `${fmtEffective(effective.deepgramModel)} (${fmtSource(sources.deepgramModel)})` : undefined}
                  />
                </span>
                <input
                  className="inputSm"
                  value={form.deepgramModel}
                  onChange={(e) => setForm({ ...form, deepgramModel: e.target.value })}
                  placeholder="nova-3"
                />
                {form.deepgramModel.trim().length === 0 && <span className="muted effectiveHint">{fmtEffective(effective.deepgramModel)}</span>}
              </div>

              <div className="formRow">
                <span className="formLabel">
                  deepgramDiarization
                  <Tooltip
                    text="Enable Deepgram diarization (speaker labels)."
                    effective={form.deepgramDiarization === "" ? `${fmtEffective(effective.deepgramDiarization)} (${fmtSource(sources.deepgramDiarization)})` : undefined}
                  />
                </span>
                <select
                  className="inputSm"
                  value={form.deepgramDiarization}
                  onChange={(e) =>
                    setForm({ ...form, deepgramDiarization: e.target.value as TriBool })
                  }
                >
                  <option value="">(inherit)</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
                {form.deepgramDiarization === "" && <span className="muted effectiveHint">{fmtEffective(effective.deepgramDiarization)}</span>}
              </div>

              <div className="formRow">
                <span className="formLabel">
                  openaiWhisperModel
                  <Tooltip
                    text="OpenAI Whisper model name (default whisper-1)."
                    effective={form.openaiWhisperModel.trim().length === 0 ? `${fmtEffective(effective.openaiWhisperModel)} (${fmtSource(sources.openaiWhisperModel)})` : undefined}
                  />
                </span>
                <input
                  className="inputSm"
                  value={form.openaiWhisperModel}
                  onChange={(e) => setForm({ ...form, openaiWhisperModel: e.target.value })}
                  placeholder="whisper-1"
                />
                {form.openaiWhisperModel.trim().length === 0 && <span className="muted effectiveHint">{fmtEffective(effective.openaiWhisperModel)}</span>}
              </div>

              <div className="formRow">
                <span className="formLabel">
                  maxAudioMB
                  <Tooltip
                    text="Max audio size (MB) before splitting. Provider limits apply if lower."
                    effective={
                      form.maxAudioMB.trim().length === 0
                        ? providerLimitMb !== undefined
                          ? `provider limit ${providerLimitMb} MB (effective ${effectiveMaxAudioMb ?? "unset"} MB)`
                          : `${fmtEffective(effective.maxAudioMB)} (${fmtSource(sources.maxAudioMB)})`
                        : undefined
                    }
                  />
                </span>
                <input
                  className="inputSm"
                  inputMode="numeric"
                  value={form.maxAudioMB}
                  onChange={(e) => setForm({ ...form, maxAudioMB: e.target.value })}
                  placeholder="inherit"
                />
                {form.maxAudioMB.trim().length === 0 && (
                  <span className="muted effectiveHint">
                    {effectiveMaxAudioMb !== undefined
                      ? `effective ${effectiveMaxAudioMb} MB`
                      : fmtEffective(effective.maxAudioMB)}
                  </span>
                )}
              </div>

              <div className="formRow">
                <span className="formLabel">
                  splitOverlapSeconds
                  <Tooltip
                    text="Overlap seconds between chunks when splitting."
                    effective={form.splitOverlapSeconds.trim().length === 0 ? `${fmtEffective(effective.splitOverlapSeconds)} (${fmtSource(sources.splitOverlapSeconds)})` : undefined}
                  />
                </span>
                <input
                  className="inputSm"
                  inputMode="numeric"
                  value={form.splitOverlapSeconds}
                  onChange={(e) => setForm({ ...form, splitOverlapSeconds: e.target.value })}
                  placeholder="inherit"
                />
                {form.splitOverlapSeconds.trim().length === 0 && <span className="muted effectiveHint">{fmtEffective(effective.splitOverlapSeconds)}</span>}
              </div>

              <div className="formRow">
                <span className="formLabel">
                  concurrency
                  <Tooltip
                    text="How many videos to process in parallel (2-4 typical; higher can hit rate limits)."
                    effective={form.concurrency.trim().length === 0 ? `${fmtEffective(effective.concurrency)} (${fmtSource(sources.concurrency)})` : undefined}
                  />
                </span>
                <input
                  className="inputXs"
                  inputMode="numeric"
                  value={form.concurrency}
                  onChange={(e) => setForm({ ...form, concurrency: e.target.value })}
                  placeholder="inherit"
                />
                {form.concurrency.trim().length === 0 && <span className="muted effectiveHint">{fmtEffective(effective.concurrency)}</span>}
              </div>
            </div>

            <div className="spacer14" />

            <h3 className="title">Language</h3>
            <div className="stackTight">
              <div className="formRow">
                <span className="formLabel">
                  languageDetection
                  <Tooltip
                    text="auto = detect per video; manual = force a languageCode."
                    effective={form.languageDetection === "" ? `${fmtEffective(effective.languageDetection)} (${fmtSource(sources.languageDetection)})` : undefined}
                  />
                </span>
                <select
                  className="inputMd"
                  value={form.languageDetection}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      languageDetection: e.target.value as LanguageDetectionOpt,
                    })
                  }
                >
                  <option value="">(inherit)</option>
                  <option value="auto">auto</option>
                  <option value="manual">manual</option>
                </select>
                {form.languageDetection === "" && <span className="muted effectiveHint">{fmtEffective(effective.languageDetection)}</span>}
              </div>
              <div className="formRow">
                <span className="formLabel">
                  languageCode
                  <Tooltip
                    text="Language code used when manual (e.g. en_us, es, fr, de). Leave empty to inherit."
                    effective={form.languageCode.trim().length === 0 ? `${fmtEffective(effective.languageCode)} (${fmtSource(sources.languageCode)})` : undefined}
                  />
                </span>
                <input
                  className="inputMd"
                  value={form.languageCode}
                  onChange={(e) => setForm({ ...form, languageCode: e.target.value })}
                  placeholder="en_us"
                />
                {form.languageCode.trim().length === 0 && <span className="muted effectiveHint">{fmtEffective(effective.languageCode)}</span>}
              </div>
            </div>

            <div className="spacer14" />

            <h3 className="title">Outputs</h3>
            <div className="stackTight">
              <div className="formRow">
                <span className="formLabel">
                  csvEnabled
                  <Tooltip
                    text="Generate a .csv alongside the canonical .json (useful for spreadsheets)."
                    effective={form.csvEnabled === "" ? `${fmtEffective(effective.csvEnabled)} (${fmtSource(sources.csvEnabled)})` : undefined}
                  />
                </span>
                <select
                  className="inputSm"
                  value={form.csvEnabled}
                  onChange={(e) => setForm({ ...form, csvEnabled: e.target.value as TriBool })}
                >
                  <option value="">(inherit)</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
                {form.csvEnabled === "" && <span className="muted effectiveHint">{fmtEffective(effective.csvEnabled)}</span>}
              </div>
              <div className="formRow">
                <span className="formLabel">
                  commentsEnabled
                  <Tooltip
                    text="Best-effort: fetch YouTube comments via yt-dlp into .comments.json (non-fatal if it fails)."
                    effective={form.commentsEnabled === "" ? `${fmtEffective(effective.commentsEnabled)} (${fmtSource(sources.commentsEnabled)})` : undefined}
                  />
                </span>
                <select
                  className="inputSm"
                  value={form.commentsEnabled}
                  onChange={(e) =>
                    setForm({ ...form, commentsEnabled: e.target.value as TriBool })
                  }
                >
                  <option value="">(inherit)</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
                {form.commentsEnabled === "" && <span className="muted effectiveHint">{fmtEffective(effective.commentsEnabled)}</span>}
              </div>
              <div className="formRow">
                <span className="formLabel">
                  commentsMax
                  <Tooltip
                    text="Max comments to fetch per video (empty = no limit)."
                    effective={form.commentsMax.trim().length === 0 ? `${fmtEffective(effective.commentsMax)} (${fmtSource(sources.commentsMax)})` : undefined}
                  />
                </span>
                <input
                  className="inputSm"
                  inputMode="numeric"
                  value={form.commentsMax}
                  onChange={(e) => setForm({ ...form, commentsMax: e.target.value })}
                  placeholder="inherit"
                />
                {form.commentsMax.trim().length === 0 && <span className="muted effectiveHint">{fmtEffective(effective.commentsMax)}</span>}
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="title">Planning</h3>
            <div className="stackTight">
              <div className="formRow">
                <span className="formLabel">
                  maxNewVideos
                  <Tooltip
                    text='Limit NEW (unprocessed) videos per run. Applied after skipping already-processed videos (good for "10 now, 10 later").'
                    effective={form.maxNewVideos.trim().length === 0 ? `${fmtEffective(effective.maxNewVideos)} (${fmtSource(sources.maxNewVideos)})` : undefined}
                  />
                </span>
                <input
                  className="inputSm"
                  inputMode="numeric"
                  value={form.maxNewVideos}
                  onChange={(e) => setForm({ ...form, maxNewVideos: e.target.value })}
                  placeholder="inherit"
                />
                {form.maxNewVideos.trim().length === 0 && <span className="muted effectiveHint">{fmtEffective(effective.maxNewVideos)}</span>}
              </div>
              <div className="formRow">
                <span className="formLabel">
                  afterDate
                  <Tooltip
                    text="Only process videos published after this date (YYYY-MM-DD)."
                    effective={form.afterDate.trim().length === 0 ? `${fmtEffective(effective.afterDate)} (${fmtSource(sources.afterDate)})` : undefined}
                  />
                </span>
                <input
                  className="inputMd"
                  value={form.afterDate}
                  onChange={(e) => setForm({ ...form, afterDate: e.target.value })}
                  placeholder="YYYY-MM-DD"
                />
                {form.afterDate.trim().length === 0 && <span className="muted effectiveHint">{fmtEffective(effective.afterDate)}</span>}
              </div>
              <div className="formRow">
                <span className="formLabel">
                  catalogMaxAgeHours
                  <Tooltip
                    text="Catalog cache TTL in hours (default 168 = 7 days). If exceeded, we force a full channel refresh for exact planning."
                    effective={form.catalogMaxAgeHours.trim().length === 0 ? `${fmtEffective(effective.catalogMaxAgeHours)} (${fmtSource(sources.catalogMaxAgeHours)})` : undefined}
                  />
                </span>
                <input
                  className="inputSm"
                  inputMode="numeric"
                  value={form.catalogMaxAgeHours}
                  onChange={(e) => setForm({ ...form, catalogMaxAgeHours: e.target.value })}
                  placeholder="inherit"
                />
                {form.catalogMaxAgeHours.trim().length === 0 && <span className="muted effectiveHint">{fmtEffective(effective.catalogMaxAgeHours)}</span>}
              </div>
            </div>

            <div className="spacer14" />

            <h3 className="title">Polling</h3>
            <div className="stackTight">
              <div className="formRow">
                <span className="formLabel">
                  pollIntervalMs
                  <Tooltip
                    text="How often to poll AssemblyAI transcription status (milliseconds)."
                    effective={form.pollIntervalMs.trim().length === 0 ? `${fmtEffective(effective.pollIntervalMs)} (${fmtSource(sources.pollIntervalMs)})` : undefined}
                  />
                </span>
                <input
                  className="inputSm"
                  inputMode="numeric"
                  value={form.pollIntervalMs}
                  onChange={(e) => setForm({ ...form, pollIntervalMs: e.target.value })}
                  placeholder="inherit"
                />
                {form.pollIntervalMs.trim().length === 0 && <span className="muted effectiveHint">{fmtEffective(effective.pollIntervalMs)}</span>}
              </div>
              <div className="formRow">
                <span className="formLabel">
                  maxPollMinutes
                  <Tooltip
                    text="Max minutes to wait for a single transcription before timing out."
                    effective={form.maxPollMinutes.trim().length === 0 ? `${fmtEffective(effective.maxPollMinutes)} (${fmtSource(sources.maxPollMinutes)})` : undefined}
                  />
                </span>
                <input
                  className="inputSm"
                  inputMode="numeric"
                  value={form.maxPollMinutes}
                  onChange={(e) => setForm({ ...form, maxPollMinutes: e.target.value })}
                  placeholder="inherit"
                />
                {form.maxPollMinutes.trim().length === 0 && <span className="muted effectiveHint">{fmtEffective(effective.maxPollMinutes)}</span>}
              </div>
            </div>

            <div className="spacer14" />

            <h3 className="title">Retries</h3>
            <div className="stackTight">
              <div className="formRow">
                <span className="formLabel">
                  downloadRetries
                  <Tooltip
                    text="Retry attempts if audio download fails (yt-dlp / transient errors)."
                    effective={form.downloadRetries.trim().length === 0 ? `${fmtEffective(effective.downloadRetries)} (${fmtSource(sources.downloadRetries)})` : undefined}
                  />
                </span>
                <input
                  className="inputXs"
                  inputMode="numeric"
                  value={form.downloadRetries}
                  onChange={(e) => setForm({ ...form, downloadRetries: e.target.value })}
                  placeholder="inherit"
                />
                {form.downloadRetries.trim().length === 0 && <span className="muted effectiveHint">{fmtEffective(effective.downloadRetries)}</span>}
              </div>
              <div className="formRow">
                <span className="formLabel">
                  transcriptionRetries
                  <Tooltip
                    text="Retry attempts if upload/transcription fails (transient network/5xx)."
                    effective={form.transcriptionRetries.trim().length === 0 ? `${fmtEffective(effective.transcriptionRetries)} (${fmtSource(sources.transcriptionRetries)})` : undefined}
                  />
                </span>
                <input
                  className="inputXs"
                  inputMode="numeric"
                  value={form.transcriptionRetries}
                  onChange={(e) => setForm({ ...form, transcriptionRetries: e.target.value })}
                  placeholder="inherit"
                />
                {form.transcriptionRetries.trim().length === 0 && <span className="muted effectiveHint">{fmtEffective(effective.transcriptionRetries)}</span>}
              </div>
              <div className="formRow">
                <span className="formLabel">
                  providerTimeoutMs
                  <Tooltip
                    text="Abort provider API calls after this many milliseconds."
                    effective={form.providerTimeoutMs.trim().length === 0 ? `${fmtEffective(effective.providerTimeoutMs)} (${fmtSource(sources.providerTimeoutMs)})` : undefined}
                  />
                </span>
                <input
                  className="inputSm"
                  inputMode="numeric"
                  value={form.providerTimeoutMs}
                  onChange={(e) => setForm({ ...form, providerTimeoutMs: e.target.value })}
                  placeholder="inherit"
                />
                {form.providerTimeoutMs.trim().length === 0 && <span className="muted effectiveHint">{fmtEffective(effective.providerTimeoutMs)}</span>}
              </div>
            </div>
          </div>

        </div>
      </div>

      <div className="card">
        <div className="row">
          <h2 className="title">Effective config (non-secret subset)</h2>
          <span className="pill">GET /settings</span>
        </div>
        <pre className="preWrap">{JSON.stringify(data.effective, null, 2)}</pre>
      </div>
    </div>
  );
}
