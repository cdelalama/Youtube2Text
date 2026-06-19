"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { components } from "../lib/apiTypes.gen";

type RunRecord = components["schemas"]["RunRecord"];
type ChannelInfo = components["schemas"]["ChannelInfo"];
type VideoInfo = components["schemas"]["VideoInfo"];
type WatchlistEntry = components["schemas"]["WatchlistEntry"];
type SchedulerStatus = components["schemas"]["SchedulerStatus"];
type SettingsGetResponse = components["schemas"]["SettingsGetResponse"];
type ProviderCapability = components["schemas"]["ProviderCapability"];
type RunPlan = components["schemas"]["RunPlan"];

type Screen =
  | "status"
  | "capture"
  | "library"
  | "libraryDetail"
  | "transcript"
  | "activity"
  | "cost"
  | "errors"
  | "sources"
  | "automations"
  | "apiOutput"
  | "settings";

type FeatureState = "LIVE" | "PARCIAL" | "ESTIMADO" | "TODAVIA NO IMPLEMENTADO";
type Lang = "es" | "en";
type Theme = "dark" | "light";
type TranscriptFormat = "read" | "txt" | "md" | "jsonl" | "csv";

const APP_VERSION = "0.36.7";

type TranscriptJson = {
  text?: string;
  utterances?: Array<{
    speaker?: string | number;
    start?: number;
    end?: number;
    text?: string;
  }>;
  languageCode?: string;
  languageConfidence?: number;
  title?: string;
  channelTitle?: string;
  videoUrl?: string;
  uploadDate?: string;
};

type MetricsSnapshot = {
  version?: string;
  runs: Record<string, number>;
  schedulerRunning?: boolean;
  nextTickSeconds?: number;
};

const navItems: Array<{ id: Screen; es: string; en: string; badge?: string; icon: IconName }> = [
  { id: "status", es: "Estado", en: "Status", icon: "pulse" },
  { id: "capture", es: "Nueva captura", en: "New capture", icon: "plus" },
  { id: "library", es: "Biblioteca", en: "Library", icon: "library" },
  { id: "sources", es: "Fuentes conectadas", en: "Connected sources", badge: "roadmap", icon: "sources" },
  { id: "activity", es: "Actividad", en: "Activity", badge: "live", icon: "activity" },
  { id: "automations", es: "Automatizaciones", en: "Automations", icon: "clock" },
  { id: "apiOutput", es: "API y salida", en: "API & output", icon: "code" },
  { id: "settings", es: "Ajustes", en: "Settings", icon: "settings" },
];

const breadcrumbs: Record<Screen, { es: string; en: string }> = {
  status: { es: "estado", en: "status" },
  capture: { es: "captura/nueva", en: "capture/new" },
  library: { es: "biblioteca", en: "library" },
  libraryDetail: { es: "biblioteca/fuente", en: "library/source" },
  transcript: { es: "biblioteca/texto", en: "library/text" },
  activity: { es: "actividad", en: "activity" },
  cost: { es: "captura/coste", en: "capture/cost" },
  errors: { es: "captura/errores", en: "capture/errors" },
  sources: { es: "fuentes", en: "sources" },
  automations: { es: "automatizaciones", en: "automations" },
  apiOutput: { es: "api/salida", en: "api/output" },
  settings: { es: "ajustes", en: "settings" },
};

type IconName = "pulse" | "plus" | "library" | "sources" | "activity" | "clock" | "code" | "settings" | "play" | "audio";

const screenIds: Screen[] = [
  "status",
  "capture",
  "library",
  "libraryDetail",
  "transcript",
  "activity",
  "cost",
  "errors",
  "sources",
  "automations",
  "apiOutput",
  "settings",
];

function t(lang: Lang, es: string, en: string): string {
  return lang === "es" ? es : en;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
  return (await res.json()) as T;
}

async function maybeJson<T>(path: string, init?: RequestInit): Promise<T | undefined> {
  try {
    return await apiJson<T>(path, init);
  } catch {
    return undefined;
  }
}

function parseMetrics(text: string): MetricsSnapshot {
  const snapshot: MetricsSnapshot = { runs: {} };
  for (const line of text.split(/\n/)) {
    const version = /^y2t_build_info\{version="([^"]+)"\}\s+1/.exec(line);
    if (version) snapshot.version = version[1];
    const run = /^y2t_runs\{status="([^"]+)"\}\s+(\d+(?:\.\d+)?)/.exec(line);
    if (run) snapshot.runs[run[1] ?? "unknown"] = Number(run[2]);
    const scheduler = /^y2t_scheduler_running\s+(\d+)/.exec(line);
    if (scheduler) snapshot.schedulerRunning = scheduler[1] === "1";
    const next = /^y2t_scheduler_next_tick_timestamp_seconds\s+(\d+)/.exec(line);
    if (next) snapshot.nextTickSeconds = Number(next[1]);
  }
  return snapshot;
}

function formatDate(value?: string): string {
  if (!value) return "-";
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

function formatDuration(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return "-";
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function timecode(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms)) return "00:00:00";
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function initials(text?: string): string {
  const clean = (text ?? "").trim();
  if (!clean) return "YT";
  const parts = clean.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "Y";
  const b = parts.length > 1 ? parts[1]?.[0] ?? "" : parts[0]?.[1] ?? "";
  return `${a}${b}`.toUpperCase();
}

function sourceType(video?: VideoInfo): "youtube" | "upload" {
  return video?.meta?.source === "upload" ? "upload" : "youtube";
}

function artifactUrl(channelDirName: string, basename: string, kind: string): string {
  return `/api/library/channels/${encodeURIComponent(channelDirName)}/videos/${encodeURIComponent(basename)}/${encodeURIComponent(kind)}`;
}

function screenFromHash(hash: string): Screen | undefined {
  const id = hash.replace(/^#/, "");
  return screenIds.includes(id as Screen) ? (id as Screen) : undefined;
}

function screenFromLocation(): Screen | undefined {
  if (typeof window === "undefined") return undefined;
  const queryScreen = new URL(window.location.href).searchParams.get("screen");
  if (queryScreen && screenIds.includes(queryScreen as Screen)) return queryScreen as Screen;
  return screenFromHash(window.location.hash);
}

function speakerKey(value: string | number | undefined, fallback: number): string {
  if (value === undefined || value === null || value === "") return String(fallback);
  return String(value).replace(/^speaker\s+/i, "").trim();
}

function speakerLabel(value: string | number | undefined, fallback: number): string {
  return `Speaker ${speakerKey(value, fallback)}`;
}

function Icon({ name }: { name: IconName }) {
  if (name === "pulse") return <svg viewBox="0 0 16 16"><path d="M1 8h3l2-4 2 8 2-4h4" /></svg>;
  if (name === "plus") return <svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" /></svg>;
  if (name === "library") return <svg viewBox="0 0 16 16"><path d="M4 2.5v11M7.5 2.5v11M11 3l2.4 10" /></svg>;
  if (name === "sources") return <svg viewBox="0 0 16 16"><path d="M8 2v7M5 6l3 3 3-3M3 13h10" /></svg>;
  if (name === "activity") return <svg viewBox="0 0 16 16"><path d="M3 13V8M6.3 13V4M9.6 13V6M13 13V3" /></svg>;
  if (name === "clock") return <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></svg>;
  if (name === "code") return <svg viewBox="0 0 16 16"><path d="M6 4 2.5 8 6 12M10 4l3.5 4-3.5 4" /></svg>;
  if (name === "settings") {
    return (
      <svg viewBox="0 0 16 16">
        <path d="M3 5h10M3 11h10" />
        <circle cx="6" cy="5" r="1.7" />
        <circle cx="10" cy="11" r="1.7" />
      </svg>
    );
  }
  if (name === "audio") return <svg viewBox="0 0 16 16"><path d="M3 9V7M6 11V5M9 10V6M13 12V4" /></svg>;
  return <svg viewBox="0 0 16 16" className="fill"><path d="M5 3l8 5-8 5z" /></svg>;
}

function FeatureBadge({ state }: { state: FeatureState }) {
  return <span className={`m2t-badge ${state === "LIVE" ? "ok" : state === "PARCIAL" ? "warn" : state === "ESTIMADO" ? "estimate" : "todo"}`}>{state}</span>;
}

function StatusPill({ status }: { status?: string }) {
  const value = status ?? "unknown";
  const klass = value === "done" ? "ok" : value === "error" ? "bad" : value === "running" || value === "queued" ? "warn" : "";
  return <span className={`m2t-pill ${klass}`}>{value.toUpperCase()}</span>;
}

function Toggle({ checked, label, onClick }: { checked?: boolean; label: string; onClick?: () => void }) {
  return (
    <button type="button" className="m2t-toggle-row" onClick={onClick} aria-pressed={Boolean(checked)}>
      <span className={`m2t-toggle ${checked ? "on" : ""}`}><span /></span>
      {label}
    </button>
  );
}

function EmptyState({ lang, title, text, cta, onClick }: { lang: Lang; title: string; text: string; cta?: string; onClick?: () => void }) {
  return (
    <div className="m2t-empty">
      <div className="m2t-empty-icon">[ ]</div>
      <div className="m2t-empty-title">{title}</div>
      <p>{text}</p>
      {cta ? <button className="m2t-button" onClick={onClick}>{cta}</button> : null}
    </div>
  );
}

function usePersistentState<T extends string>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    const stored = window.localStorage.getItem(key);
    if (stored) setValue(stored as T);
  }, [key]);
  const update = (next: T) => {
    setValue(next);
    window.localStorage.setItem(key, next);
  };
  return [value, update];
}

export function MediaConsole({ initialScreen = "status" }: { initialScreen?: Screen }) {
  const [lang, setLang] = usePersistentState<Lang>("m2t.lang", "es");
  const [theme, setTheme] = usePersistentState<Theme>("m2t.theme", "dark");
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [scheduler, setScheduler] = useState<SchedulerStatus | undefined>();
  const [settings, setSettings] = useState<SettingsGetResponse | undefined>();
  const [providers, setProviders] = useState<ProviderCapability[]>([]);
  const [metrics, setMetrics] = useState<MetricsSnapshot>({ runs: {} });
  const [selectedChannel, setSelectedChannel] = useState<ChannelInfo | undefined>();
  const [selectedVideo, setSelectedVideo] = useState<VideoInfo | undefined>();
  const [transcript, setTranscript] = useState<TranscriptJson | undefined>();
  const [rawTranscript, setRawTranscript] = useState("");
  const [comments, setComments] = useState<unknown[] | undefined>();
  const [format, setFormat] = useState<TranscriptFormat>("read");
  const [inputUrl, setInputUrl] = useState("");
  const [maxNewVideos, setMaxNewVideos] = useState("10");
  const [force, setForce] = useState(false);
  const [plan, setPlan] = useState<RunPlan | undefined>();
  const [captureTab, setCaptureTab] = useState<"link" | "audio">("link");
  const [uploadFile, setUploadFile] = useState<File | undefined>();
  const [toast, setToast] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [settingsDraft, setSettingsDraft] = useState<Record<string, string>>({});
  const [watchDraftUrl, setWatchDraftUrl] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const apiVersion = metrics.version;
  const totalRuns = runs.length;
  const doneRuns = runs.filter((r) => r.status === "done").length;
  const failedRuns = runs.filter((r) => r.status === "error").length;
  const runningRuns = runs.filter((r) => r.status === "running" || r.status === "queued").length;
  const videoStats = useMemo(() => {
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    for (const run of runs) {
      succeeded += run.stats?.succeeded ?? run.videoResults?.filter((v) => v.status === "done").length ?? 0;
      failed += run.stats?.failed ?? run.videoResults?.filter((v) => v.status === "error").length ?? 0;
      skipped += run.stats?.skipped ?? run.videoResults?.filter((v) => v.status === "skipped").length ?? 0;
    }
    return { succeeded, failed, skipped, attempts: succeeded + failed };
  }, [runs]);
  const successRate = videoStats.attempts > 0 ? Math.round((videoStats.succeeded / videoStats.attempts) * 1000) / 10 : undefined;

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 2600);
  }

  async function refreshAll() {
    const [runsRes, channelsRes, watchlistRes, schedulerRes, settingsRes, providersRes] = await Promise.all([
      maybeJson<{ runs: RunRecord[] }>("/api/runs"),
      maybeJson<{ channels: ChannelInfo[] }>("/api/library/channels"),
      maybeJson<{ entries: WatchlistEntry[] }>("/api/watchlist"),
      maybeJson<{ status: SchedulerStatus }>("/api/scheduler/status"),
      maybeJson<SettingsGetResponse>("/api/settings"),
      maybeJson<{ providers: ProviderCapability[] }>("/api/providers"),
    ]);
    setRuns(runsRes?.runs ?? []);
    setChannels(channelsRes?.channels ?? []);
    setWatchlist(watchlistRes?.entries ?? []);
    setScheduler(schedulerRes?.status);
    setSettings(settingsRes);
    setProviders(providersRes?.providers ?? []);
    setSettingsDraft({
      sttProvider: settingsRes?.effective?.sttProvider ?? "assemblyai",
      languageDetection: settingsRes?.effective?.languageDetection ?? "auto",
      languageCode: settingsRes?.effective?.languageCode ?? "",
      commentsEnabled: String(settingsRes?.effective?.commentsEnabled ?? true),
      commentsMax: String(settingsRes?.effective?.commentsMax ?? 100),
    });
    try {
      const text = await fetch("/api/metrics", { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""));
      if (text) setMetrics(parseMetrics(text));
    } catch {
      setMetrics({ runs: {} });
    }
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    const applyHash = () => {
      const next = screenFromLocation();
      if (next) setScreen(next);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    window.addEventListener("popstate", applyHash);
    return () => {
      window.removeEventListener("hashchange", applyHash);
      window.removeEventListener("popstate", applyHash);
    };
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/events");
    const handler = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data) as { run?: RunRecord };
        if (!parsed.run?.runId) return;
        setRuns((prev) => {
          const idx = prev.findIndex((r) => r.runId === parsed.run?.runId);
          const next = idx >= 0 ? [...prev.slice(0, idx), parsed.run!, ...prev.slice(idx + 1)] : [parsed.run!, ...prev];
          return next.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        });
      } catch {
        // Ignore malformed SSE payloads.
      }
    };
    es.addEventListener("run:created", handler);
    es.addEventListener("run:updated", handler);
    es.onerror = () => undefined;
    return () => es.close();
  }, []);

  useEffect(() => {
    if (!selectedChannel) {
      setVideos([]);
      return;
    }
    void maybeJson<{ videos: VideoInfo[] }>(`/api/library/channels/${encodeURIComponent(selectedChannel.channelDirName)}/videos`).then((data) => {
      setVideos(data?.videos ?? []);
    });
  }, [selectedChannel]);

  useEffect(() => {
    if (!selectedChannel || !selectedVideo) {
      setTranscript(undefined);
      setRawTranscript("");
      setComments(undefined);
      return;
    }
    const base = `/api/library/channels/${encodeURIComponent(selectedChannel.channelDirName)}/videos/${encodeURIComponent(selectedVideo.basename)}`;
    void maybeJson<TranscriptJson>(`${base}/json`).then(setTranscript);
    void fetch(`${base}/${format === "read" ? "txt" : format}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.text() : ""))
      .then(setRawTranscript)
      .catch(() => setRawTranscript(""));
    void maybeJson<{ comments?: unknown[] }>(`${base}/comments`).then((data) => setComments(Array.isArray(data?.comments) ? data?.comments : undefined));
  }, [selectedChannel, selectedVideo, format]);

  function go(next: Screen) {
    setScreen(next);
    const url = new URL(window.location.href);
    url.searchParams.set("screen", next);
    url.hash = "";
    const target = `${url.pathname}${url.search}${url.hash}`;
    if (window.location.pathname + window.location.search + window.location.hash !== target) {
      window.history.pushState(null, "", target);
    }
  }

  function openChannel(channel: ChannelInfo) {
    setSelectedChannel(channel);
    setScreen("libraryDetail");
  }

  function openVideo(video: VideoInfo) {
    setSelectedVideo(video);
    setFormat("read");
    setScreen("transcript");
  }

  async function previewPlan() {
    if (!inputUrl.trim()) return;
    setBusy("plan");
    try {
      const body: Record<string, unknown> = { url: inputUrl.trim(), force };
      const max = Number(maxNewVideos);
      if (Number.isFinite(max) && max > 0) body.maxNewVideos = Math.trunc(max);
      const data = await apiJson<{ plan: RunPlan }>("/api/runs/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setPlan(data.plan);
      showToast(t(lang, "Plan actualizado", "Plan refreshed"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function startRun() {
    setBusy("run");
    try {
      if (captureTab === "audio") {
        if (!uploadFile) {
          showToast(t(lang, "Selecciona un audio primero", "Choose an audio file first"));
          return;
        }
        const form = new FormData();
        form.set("file", uploadFile);
        const uploaded = await apiJson<{ audio: { audioId: string } }>("/api/audio", {
          method: "POST",
          body: form,
        });
        const created = await apiJson<{ run: RunRecord }>("/api/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ audioId: uploaded.audio.audioId, force }),
        });
        setRuns((prev) => [created.run, ...prev]);
        setInputUrl("");
        setUploadFile(undefined);
        showToast(t(lang, "Audio en transcripción", "Audio transcription queued"));
      } else {
        if (!inputUrl.trim()) return;
        const body: Record<string, unknown> = { url: inputUrl.trim(), force };
        const max = Number(maxNewVideos);
        if (Number.isFinite(max) && max > 0) body.maxNewVideos = Math.trunc(max);
        const created = await apiJson<{ run: RunRecord }>("/api/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        setRuns((prev) => [created.run, ...prev]);
        showToast(t(lang, "Run creado", "Run created"));
      }
      await refreshAll();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function saveSettings() {
    setBusy("settings");
    try {
      const payload = {
        settings: {
          sttProvider: settingsDraft.sttProvider || null,
          languageDetection: settingsDraft.languageDetection || null,
          languageCode: settingsDraft.languageCode || null,
          commentsEnabled: settingsDraft.commentsEnabled === "true",
          commentsMax: Number(settingsDraft.commentsMax) || null,
        },
      };
      const next = await apiJson<SettingsGetResponse>("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSettings(next);
      showToast(t(lang, "Ajustes guardados", "Settings saved"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  async function addWatchRule(url: string) {
    if (!url.trim()) return;
    setBusy("watch");
    try {
      const res = await apiJson<{ entry: WatchlistEntry }>("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelUrl: url.trim(), enabled: true }),
      });
      setWatchlist((prev) => [...prev, res.entry]);
      setWatchDraftUrl("");
      showToast(t(lang, "Regla guardada", "Rule saved"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  }

  const firstVideo = videos[0];
  const selectedTitle = selectedVideo?.title ?? selectedVideo?.meta?.title ?? transcript?.title ?? t(lang, "Transcripción", "Transcript");

  return (
    <div className={`m2t-root ${theme === "light" ? "theme-light" : ""}`}>
      <aside className="m2t-sidebar">
        <div className="m2t-brand">
          <div className="m2t-logo"><span /><span /><span /></div>
          <div>
            <div className="m2t-brand-title">Media2Text</div>
            <div className="m2t-brand-sub">app v{APP_VERSION}</div>
          </div>
        </div>
        <div className="m2t-menu-label">MENU</div>
        <nav className="m2t-nav">
          {navItems.map((item) => (
            <button key={item.id} className="m2t-nav-item" data-active={screen === item.id || (item.id === "library" && (screen === "libraryDetail" || screen === "transcript"))} onClick={() => go(item.id)}>
              <span className="m2t-icon"><Icon name={item.icon} /></span>
              <span>{t(lang, item.es, item.en)}</span>
              {item.badge === "live" ? <span className="m2t-nav-dot">2</span> : null}
              {item.badge === "roadmap" ? <span className="m2t-nav-dot warn">312</span> : null}
            </button>
          ))}
        </nav>
        <div className="m2t-side-card">
          <div className="m2t-card-row">
            <span className="m2t-mini-square">P</span>
            <strong>Plaud</strong>
            <span className="m2t-pending">{t(lang, "○ EN ESPERA", "○ PENDING")}</span>
          </div>
          <p>{t(lang, "Webhook visible en roadmap. Conector inbound pendiente.", "Roadmap-visible webhook. Inbound connector pending.")}</p>
          <FeatureBadge state="TODAVIA NO IMPLEMENTADO" />
        </div>
        <div className="m2t-sidebar-bottom">
          <div className="m2t-theme-switch">
            <button data-active={theme === "dark"} onClick={() => setTheme("dark")}>DARK</button>
            <button data-active={theme === "light"} onClick={() => setTheme("light")}>LIGHT</button>
          </div>
          <div className="m2t-engine"><span />{t(lang, "Motor conectado", "Engine connected")}</div>
          <div className="m2t-engine-sub">engine y2t v{apiVersion ?? APP_VERSION} · :8787</div>
        </div>
      </aside>

      <div className="m2t-main">
        <header className="m2t-topbar">
          <div className="m2t-breadcrumb">~/ <span>{t(lang, breadcrumbs[screen].es, breadcrumbs[screen].en)}</span></div>
          <div className="m2t-top-actions">
            <div className="m2t-kbd">⌘K</div>
            <div className="m2t-lang">
              <button data-active={lang === "es"} onClick={() => setLang("es")}>ES</button>
              <button data-active={lang === "en"} onClick={() => setLang("en")}>EN</button>
            </div>
          </div>
        </header>
        <main className="m2t-content">
          {screen === "status" ? renderStatus() : null}
          {screen === "capture" ? renderCapture() : null}
          {screen === "library" ? renderLibrary() : null}
          {screen === "libraryDetail" ? renderLibraryDetail() : null}
          {screen === "transcript" ? renderTranscript() : null}
          {screen === "activity" ? renderActivity() : null}
          {screen === "cost" ? renderCost() : null}
          {screen === "errors" ? renderErrors() : null}
          {screen === "sources" ? renderSources() : null}
          {screen === "automations" ? renderAutomations() : null}
          {screen === "apiOutput" ? renderApiOutput() : null}
          {screen === "settings" ? renderSettings() : null}
        </main>
      </div>

      <nav className="m2t-mobile-tabs">
        {(["status", "capture", "library", "sources", "settings"] as Screen[]).map((id) => {
          const item = navItems.find((n) => n.id === id)!;
          return (
            <button key={id} data-active={screen === id} onClick={() => go(id)}>
              <Icon name={item.icon} />
              <span>{t(lang, item.es, item.en)}</span>
            </button>
          );
        })}
      </nav>

      {toast ? <div className="m2t-toast">{toast}</div> : null}
    </div>
  );

  function renderStatus() {
    return (
      <section className="m2t-page">
        <PageIntro title={t(lang, "Estado", "Status")} text={t(lang, "Media2Text es un servicio de ingesta headless. Esta consola sirve para configurarlo y vigilarlo; el trabajo ocurre solo.", "Media2Text is a headless ingest service. This console configures and monitors it; the work runs on its own.")} />
        <button className="m2t-system-banner" onClick={() => go("activity")}>
          <span className="m2t-live"><span />{scheduler?.running ? t(lang, "CRON ACTIVO", "CRON RUNNING") : t(lang, "CRON PARADO", "CRON STOPPED")}</span>
          <span>{t(lang, "próxima sync", "next sync")} <strong>{scheduler?.nextTickAt ? formatDate(scheduler.nextTickAt) : "-"}</strong></span>
          <span>runs <strong>{totalRuns}</strong></span>
          <span>{t(lang, "activos", "active")} <strong>{runningRuns}</strong></span>
          <em>{t(lang, "ver actividad", "view activity")} →</em>
        </button>

        <div className="m2t-metrics">
          <Metric label={t(lang, "PROCESADOS", "PROCESSED")} value={String(videoStats.succeeded || doneRuns)} text={t(lang, "ítems transcritos en total", "items transcribed in total")} />
          <Metric label={t(lang, "TASA DE ÉXITO", "SUCCESS RATE")} value={successRate === undefined ? "-" : `${successRate}%`} accent text={`${videoStats.succeeded} ÷ ${videoStats.attempts || 0}`} />
          <Metric label={t(lang, "COSTE (MES)", "COST (MONTH)")} value="—" text={t(lang, "pendiente de /metrics/cost", "waiting for /metrics/cost")} onClick={() => go("cost")} state="ESTIMADO" />
          <Metric label={t(lang, "FALLIDOS", "FAILED")} value={String(videoStats.failed || failedRuns)} danger text={t(lang, "ver y reintentar", "view and retry")} onClick={() => go("errors")} />
        </div>
        <div className="m2t-honesty"><span>ƒ</span>{t(lang, "Runs y biblioteca vienen del motor. Coste y backlog son visibles como roadmap hasta que exista /metrics/cost y cola persistida.", "Runs and library come from the engine. Cost and backlog are roadmap-visible until /metrics/cost and persisted queue exist.")}</div>

        <SectionHeader title={t(lang, "Actividad", "Activity")} right={<span className="m2t-live"><span />LIVE</span>} />
        <RunsTable runs={runs.slice(0, 5)} lang={lang} onOpenRun={(run) => {
          if (run.channelDirName) {
            const channel = channels.find((c) => c.channelDirName === run.channelDirName);
            if (channel) openChannel(channel);
          }
        }} />
        <div className="m2t-next"><span>NEXT</span>{t(lang, "El texto guardado alimenta tus servicios de IA: resúmenes, búsqueda semántica y Q&A sobre todo el corpus.", "Saved text feeds AI services: summaries, semantic search and Q&A across the corpus.")}</div>
      </section>
    );
  }

  function renderCapture() {
    return (
      <section className="m2t-page">
        <div className="m2t-composer">
          <div className="m2t-tabs">
            <button data-active={captureTab === "link"} onClick={() => setCaptureTab("link")}>{t(lang, "PEGAR ENLACE", "PASTE LINK")}</button>
            <button data-active={captureTab === "audio"} onClick={() => setCaptureTab("audio")}>{t(lang, "SUBIR AUDIO ↑", "UPLOAD AUDIO ↑")}</button>
          </div>
          {captureTab === "link" ? (
            <div className="m2t-input-line">
              <span>&gt;</span>
              <input value={inputUrl} onChange={(e) => setInputUrl(e.target.value)} placeholder="youtube.com/@channel | playlist | video" />
              <span className="m2t-detected">{inputUrl.includes("youtube") || inputUrl.includes("youtu.be") ? t(lang, "✓ YOUTUBE DETECTADO", "✓ YOUTUBE DETECTED") : t(lang, "AUTO-DETECCIÓN", "AUTO-DETECT")}</span>
            </div>
          ) : (
            <button className="m2t-dropzone" onClick={() => fileRef.current?.click()}>
              <input ref={fileRef} type="file" accept=".m4a,.mp3,.wav,.ogg,.flac" onChange={(e) => setUploadFile(e.target.files?.[0])} />
              <strong>{uploadFile ? uploadFile.name : t(lang, "m4a / mp3 / wav / ogg / flac", "m4a / mp3 / wav / ogg / flac")}</strong>
              <span>{t(lang, "POST /audio está LIVE. El run usa audioId.", "POST /audio is LIVE. The run uses audioId.")}</span>
            </button>
          )}
          <div className="m2t-composer-actions">
            <Toggle checked={force} onClick={() => setForce(!force)} label={t(lang, "Re-transcribir todo", "Re-transcribe everything")} />
            <span>{t(lang, "Solo nuevos", "New only")}</span>
            <input className="m2t-small-input" value={maxNewVideos} onChange={(e) => setMaxNewVideos(e.target.value)} aria-label="max new videos" />
            <span>{t(lang, "Idioma", "Language")} <strong>auto</strong></span>
            <button className="m2t-link-button" onClick={() => void previewPlan()} disabled={busy === "plan" || captureTab !== "link"}>{busy === "plan" ? t(lang, "Calculando", "Planning") : t(lang, "Previsualizar plan →", "Preview plan →")}</button>
            <button className="m2t-button" onClick={() => void startRun()} disabled={busy === "run"}>{busy === "run" ? t(lang, "Lanzando", "Starting") : t(lang, "Transcribir", "Transcribe")}</button>
          </div>
          {plan ? (
            <div className="m2t-plan">
              <span>total {plan.totalVideos}</span>
              <span>processed {plan.alreadyProcessed}</span>
              <span>selected {plan.toProcess}</span>
              <span>{plan.channelTitle ?? plan.channelId}</span>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  function renderLibrary() {
    return (
      <section className="m2t-page">
        <PageIntro title={t(lang, "Biblioteca", "Library")} text={t(lang, "Todo tu corpus de texto. Haz clic en una fuente para ver su contenido.", "Your text corpus. Click a source to inspect its content.")} />
        <div className="m2t-filter-row">
          <button data-active>TODO</button>
          <button>CANALES</button>
          <button>AUDIOS</button>
          <button className="m2t-button slim" onClick={() => { setCaptureTab("audio"); go("capture"); }}>{t(lang, "↑ Subir audio", "↑ Upload audio")}</button>
        </div>
        {channels.length === 0 ? (
          <EmptyState lang={lang} title={t(lang, "Tu biblioteca está vacía", "Your library is empty")} text={t(lang, "Conecta una fuente o lanza una captura y el texto aparecerá aquí.", "Connect a source or start a capture and text will appear here.")} cta={t(lang, "Ir a Nueva captura", "Go to New capture")} onClick={() => go("capture")} />
        ) : (
          <div className="m2t-library-grid">
            {channels.map((channel, idx) => (
              <button className="m2t-source-card" key={channel.channelDirName} onClick={() => openChannel(channel)}>
                {channel.channelThumbnailUrl ? <img src={channel.channelThumbnailUrl} alt="" /> : <span className={`m2t-avatar tone-${idx % 4}`}>{initials(channel.channelTitle)}</span>}
                <strong>{channel.channelTitle ?? channel.channelDirName}</strong>
                <FeatureBadge state="LIVE" />
                <div>
                  <span>{channel.channelId}</span>
                  <em>→</em>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    );
  }

  function renderLibraryDetail() {
    const channel = selectedChannel ?? channels[0];
    return (
      <section className="m2t-page">
        <button className="m2t-back" onClick={() => go("library")}>← {t(lang, "Biblioteca", "Library")}</button>
        <div className="m2t-source-hero">
          <span className="m2t-avatar tone-0">{initials(channel?.channelTitle)}</span>
          <div>
            <h1>{channel?.channelTitle ?? t(lang, "Fuente", "Source")}</h1>
            <p>{videos.length} {t(lang, "ítems", "items")} · {t(lang, "última sync según archivos locales", "latest sync from local files")}</p>
          </div>
          <button className="m2t-button secondary" onClick={() => go("automations")}>+ {t(lang, "Vigilar este canal", "Watch this channel")}</button>
          <button className="m2t-button" onClick={() => {
            if (channel?.channelId) {
              setInputUrl(`https://www.youtube.com/channel/${channel.channelId}`);
              go("capture");
            }
          }}>{t(lang, "Re-sincronizar", "Re-sync")}</button>
        </div>
        {videos.length === 0 ? (
          <EmptyState lang={lang} title={t(lang, "Sin vídeos locales", "No local videos")} text={t(lang, "La fuente existe, pero no hay artefactos listados todavía.", "The source exists, but no artifacts are listed yet.")} />
        ) : (
          <div className="m2t-table">
            <div className="m2t-tr head"><span>TÍTULO</span><span>DURACIÓN</span><span>PALABRAS</span><span>ESTADO</span></div>
            {videos.map((video) => (
              <button className="m2t-tr" key={video.basename} onClick={() => openVideo(video)}>
                <span><Icon name={sourceType(video) === "upload" ? "audio" : "play"} /> <strong>{video.title ?? video.meta?.title ?? video.basename}</strong><small>{formatDate(video.meta?.uploadDate ?? video.meta?.createdAt)}</small></span>
                <span>-</span>
                <span>{video.meta?.languageCode ?? "-"}</span>
                <span><StatusPill status="done" /></span>
              </button>
            ))}
          </div>
        )}
      </section>
    );
  }

  function renderTranscript() {
    const utterances = transcript?.utterances ?? [];
    const speakerKeys = Array.from(new Set(utterances.map((u, idx) => speakerKey(u.speaker, idx % 2)))).slice(0, 6);
    const speakerIndex = new Map(speakerKeys.map((key, idx) => [key, idx]));
    return (
      <section className="m2t-page">
        <button className="m2t-back" onClick={() => go("libraryDetail")}>← {selectedChannel?.channelTitle ?? t(lang, "Fuente", "Source")}</button>
        <div className="m2t-transcript-head">
          <div>
            <h1>{selectedTitle}</h1>
            <p>{transcript?.channelTitle ?? selectedChannel?.channelTitle ?? "-"} · {transcript?.languageCode ?? selectedVideo?.meta?.languageCode ?? "auto"} · {new Set(utterances.map((u) => String(u.speaker ?? ""))).size || "-"} {t(lang, "hablantes", "speakers")}</p>
          </div>
          <FeatureBadge state="LIVE" />
          <button className="m2t-button secondary" onClick={() => navigator.clipboard?.writeText(format === "read" ? utterances.map((u) => u.text ?? "").join("\n") : rawTranscript).then(() => showToast(t(lang, "Copiado", "Copied")))}>Copiar</button>
          {selectedChannel && selectedVideo ? <a className="m2t-button" href={artifactUrl(selectedChannel.channelDirName, selectedVideo.basename, format === "read" ? "txt" : format)} target="_blank">↓ Descargar</a> : null}
        </div>
        <div className="m2t-subtabs">
          <button data-active>{t(lang, "Transcripción", "Transcript")}</button>
          <button>{t(lang, "Comentarios", "Comments")} <span>{comments?.length ?? 0}</span></button>
          <FeatureBadge state="LIVE" />
        </div>
        <div className="m2t-format-row">
          {(["read", "txt", "md", "jsonl", "csv"] as TranscriptFormat[]).map((id) => (
            <button key={id} data-active={format === id} onClick={() => setFormat(id)}>{id === "read" ? "LECTURA" : id.toUpperCase()}</button>
          ))}
          <span>{format === "read" ? t(lang, "vista legible con hablantes y marcas de tiempo", "readable view with speakers and timestamps") : "src/formatters/"}</span>
        </div>
        <div className="m2t-speaker-map">
          <div>
            <strong>{t(lang, "Mapa de hablantes", "Speaker map")}</strong>
            <span>{t(lang, "Los speakers vienen del STT; renombrar a personas queda pendiente.", "Speakers come from STT; naming people is still pending.")}</span>
          </div>
          <FeatureBadge state="TODAVIA NO IMPLEMENTADO" />
          {(speakerKeys.length > 0 ? speakerKeys : ["0", "1"]).map((key, idx) => (
            <label key={key}>
              <span className={`m2t-speaker speaker-${idx % 4}`}>Speaker {key}</span>
              <input disabled value="" placeholder={t(lang, "Nombre futuro", "Future name")} />
            </label>
          ))}
        </div>
        {format === "read" ? (
          <div className="m2t-reading">
            {utterances.length === 0 ? <EmptyState lang={lang} title={t(lang, "Transcripción no cargada", "Transcript not loaded")} text={t(lang, "Abre un artefacto JSON válido para ver la lectura.", "Open a valid JSON artifact to see the reading view.")} /> : null}
            {utterances.map((u, idx) => (
              <div className="m2t-utterance" key={`${idx}-${u.start}`}>
                <div>
                  <span className={`m2t-speaker speaker-${(speakerIndex.get(speakerKey(u.speaker, idx % 2)) ?? idx) % 4}`}>{speakerLabel(u.speaker, idx % 2)}</span>
                  <small>{timecode(u.start)}</small>
                </div>
                <p>{u.text}</p>
              </div>
            ))}
          </div>
        ) : (
          <pre className="m2t-pre">{rawTranscript || t(lang, "Sin contenido para este formato.", "No content for this format.")}</pre>
        )}
        <div className="m2t-note">
          <FeatureBadge state="PARCIAL" />
          {t(lang, "Los labels Speaker 0/1 vienen de diarización real. Renombrarlos a personas concretas queda como adaptación backend futura.", "Speaker 0/1 labels come from real diarization. Renaming them to people is a future backend adaptation.")}
        </div>
      </section>
    );
  }

  function renderActivity() {
    return (
      <section className="m2t-page">
        <PageIntro title={t(lang, "Actividad", "Activity")} text={t(lang, "Salud del motor, scheduler y últimas ejecuciones.", "Engine health, scheduler, and recent runs.")} />
        <div className="m2t-health-grid">
          <HealthTile label="MOTOR" value={t(lang, "Operativo", "Operational")} state="LIVE" />
          <HealthTile label="CRON" value={scheduler?.running ? t(lang, "Activo", "Running") : t(lang, "Parado", "Stopped")} state="LIVE" />
          <HealthTile label={t(lang, "ÚLTIMAS 24 H", "LAST 24 H")} value={`+${runs.filter((r) => Date.now() - Date.parse(r.createdAt) < 86400000).length}`} state="LIVE" />
          <HealthTile label={t(lang, "ALERTAS", "ALERTS")} value={String(failedRuns)} state="PARCIAL" />
        </div>
        <SectionHeader title={t(lang, "Alertas", "Alerts")} right={<FeatureBadge state="PARCIAL" />} />
        <div className="m2t-alerts">
          <div><strong>CLAVE</strong><span>{t(lang, "Los estados por clave se inferirán cuando exista gestión segura de secretos.", "Per-key states need secure secret management.")}</span><FeatureBadge state="PARCIAL" /></div>
          <div><strong>COLA</strong><span>{t(lang, "Backlog por webhook pendiente de cola persistida.", "Webhook backlog waits for persisted queue.")}</span><FeatureBadge state="TODAVIA NO IMPLEMENTADO" /></div>
        </div>
        <SectionHeader title={t(lang, "Historial de ejecuciones", "Run history")} />
        <RunsTable runs={runs} lang={lang} onOpenRun={() => undefined} />
      </section>
    );
  }

  function renderCost() {
    return (
      <section className="m2t-page">
        <PageIntro title={t(lang, "Coste estimado", "Estimated cost")} text={t(lang, "Estimación visual hasta implementar /metrics/cost con minutos y tarifas por proveedor.", "Visual estimate until /metrics/cost ships with minutes and provider rates.")} badge={<FeatureBadge state="ESTIMADO" />} />
        <div className="m2t-metrics">
          <Metric label={t(lang, "TOTAL · MES", "TOTAL · MONTH")} value="—" text="/metrics/cost TODO" state="ESTIMADO" />
          <Metric label={t(lang, "MINUTOS", "MINUTES")} value="—" text={t(lang, "pendiente de cálculo", "calculation pending")} state="ESTIMADO" />
          <Metric label={t(lang, "COSTE/HORA", "COST/HOUR")} value="—" text={t(lang, "tarifa configurable pendiente", "configurable rate pending")} state="ESTIMADO" />
          <Metric label={t(lang, "PROYECCIÓN MES", "MONTH PROJECTION")} value="—" text={t(lang, "no autoritativo", "not authoritative")} state="ESTIMADO" />
        </div>
        <div className="m2t-two-col">
          <RoadmapPanel title={t(lang, "Por proveedor", "By provider")} lines={["AssemblyAI —", "Deepgram —", "Whisper —"]} state="ESTIMADO" />
          <RoadmapPanel title={t(lang, "Presupuesto", "Budget")} lines={[t(lang, "Sin presupuesto activo", "No active budget"), t(lang, "Avisar al 80%", "Warn at 80%"), t(lang, "Pausar al 100%", "Pause at 100%")]} state="TODAVIA NO IMPLEMENTADO" />
        </div>
      </section>
    );
  }

  function renderErrors() {
    const errored = runs.filter((r) => r.status === "error" || (r.stats?.failed ?? 0) > 0);
    return (
      <section className="m2t-page">
        <PageIntro title={`${errored.length} ${t(lang, "fallidos", "failed")}`} text={t(lang, "Errores reales de runs cuando existen; acciones masivas esperan backend específico.", "Real run errors when present; bulk actions wait for backend support.")} />
        <div className="m2t-action-row">
          <button className="m2t-button secondary" disabled>{t(lang, "Descartar todos", "Dismiss all")} <FeatureBadge state="TODAVIA NO IMPLEMENTADO" /></button>
          <button className="m2t-button" onClick={() => showToast(t(lang, "Reintento masivo pendiente de backend", "Bulk retry needs backend support"))}>↻ {t(lang, "Reintentar todos", "Retry all")}</button>
        </div>
        {errored.length === 0 ? <EmptyState lang={lang} title={t(lang, "Sin fallos", "No failures")} text={t(lang, "No hay runs fallidos en el estado actual.", "There are no failed runs in current state.")} /> : (
          <div className="m2t-table">
            <div className="m2t-tr head"><span>FUENTE</span><span>TIPO</span><span>MOTIVO</span><span>ACCIÓN</span></div>
            {errored.map((run) => (
              <div className="m2t-tr" key={run.runId}><span><strong>{run.previewTitle ?? run.channelTitle ?? run.inputUrl}</strong><small>{run.runId}</small></span><span>RUN</span><span className="bad-text">{run.error ?? `${run.stats?.failed ?? 0} failed videos`}</span><span><button className="m2t-link-button" onClick={() => { setInputUrl(run.inputUrl); go("capture"); }}>↻ Retry</button></span></div>
            ))}
          </div>
        )}
      </section>
    );
  }

  function renderSources() {
    return (
      <section className="m2t-page">
        <PageIntro title={t(lang, "Fuentes conectadas", "Connected sources")} text={t(lang, "Entradas actuales y futuras para alimentar el motor.", "Current and future inputs feeding the engine.")} />
        <div className="m2t-backlog">
          <div><strong>312</strong><span>{t(lang, "en cola desde la última sync", "queued since last sync")}</span><FeatureBadge state="TODAVIA NO IMPLEMENTADO" /></div>
          <button className="m2t-button warn" onClick={() => showToast(t(lang, "La cola persistida todavía no existe", "Persisted queue does not exist yet"))}>{t(lang, "Procesar", "Process")}</button>
        </div>
        <div className="m2t-source-list">
          <RoadmapPanel title="Plaud" lines={[t(lang, "Webhook inbound pendiente", "Inbound webhook pending"), ":8787/hooks/plaud/..."]} state="TODAVIA NO IMPLEMENTADO" />
          <RoadmapPanel title="Google Drive" lines={[t(lang, "Vigila una carpeta", "Watch a folder"), t(lang, "No implementado", "Not implemented")]} state="TODAVIA NO IMPLEMENTADO" />
          <RoadmapPanel title={t(lang, "Webhook genérico", "Generic webhook")} lines={[t(lang, "Cualquier servicio que envíe URL/audio", "Any service posting URL/audio"), t(lang, "No implementado", "Not implemented")]} state="TODAVIA NO IMPLEMENTADO" />
        </div>
      </section>
    );
  }

  function renderAutomations() {
    return (
      <section className="m2t-page">
        <PageIntro title={t(lang, "Automatizaciones", "Automations")} text={t(lang, "Reglas basadas en watchlist y scheduler actuales.", "Rules backed by current watchlist and scheduler.")} badge={<FeatureBadge state="LIVE" />} />
        <div className="m2t-composer compact">
          <div className="m2t-input-line"><span>&gt;</span><input value={watchDraftUrl} onChange={(e) => setWatchDraftUrl(e.target.value)} placeholder="https://www.youtube.com/@channel" /></div>
          <button className="m2t-button" onClick={() => void addWatchRule(watchDraftUrl)}>+ {t(lang, "Nueva regla", "New rule")}</button>
        </div>
        <div className="m2t-table">
          <div className="m2t-tr head"><span>FUENTE VIGILADA</span><span>FRECUENCIA</span><span>ÚLTIMA EJEC.</span><span>ACTIVA</span></div>
          {watchlist.map((entry) => (
            <div className="m2t-tr" key={entry.id}><span><strong>{entry.channelTitle ?? entry.channelUrl}</strong><small>{entry.channelUrl}</small></span><span>{entry.intervalMinutes ? `${Math.round(entry.intervalMinutes / 60)}h` : "global"}</span><span>{formatDate(entry.lastCheckedAt)}</span><span><StatusPill status={entry.enabled ? "done" : "cancelled"} /></span></div>
          ))}
        </div>
        <RoadmapPanel
          title={t(lang, "Editor de regla", "Rule editor")}
          lines={[
            t(lang, "Frecuencia 6 h / 12 h / 24 h / manual", "Frequency 6 h / 12 h / 24 h / manual"),
            t(lang, "Máx nuevos por ejecución, idioma y regla activa", "Max new per run, language, and active rule"),
            t(lang, "El backend ya guarda watchlist; el modal completo queda pendiente.", "Backend stores watchlist; the full modal remains pending."),
          ]}
          state="PARCIAL"
        />
        {watchlist.length === 0 ? <EmptyState lang={lang} title={t(lang, "Sin reglas", "No rules")} text={t(lang, "Añade un canal para activar la vigilancia incremental.", "Add a channel to activate incremental watch.")} /> : null}
      </section>
    );
  }

  function renderApiOutput() {
    return (
      <section className="m2t-page">
        <PageIntro title={t(lang, "API y salida", "API & output")} text={t(lang, "La API actual sirve runs, biblioteca, eventos y artefactos. El feed estable para Cortex queda marcado como roadmap.", "The current API serves runs, library, events, and artifacts. The stable Cortex feed is marked as roadmap.")} />
        <div className="m2t-flow"><span>ENTRADA<br /><em>YouTube · audio</em></span><span>MEDIA2TEXT<br /><em>engine y2t</em></span><span>SALIDA<br /><em>artifacts · webhooks</em></span></div>
        <div className="m2t-two-col">
          <RoadmapPanel title={t(lang, "Feed de salida (PULL)", "Output feed (PULL)")} lines={["GET /v1/transcripts?since=...&format=jsonl", t(lang, "Contrato estable para Cortex pendiente", "Stable Cortex contract pending")]} state="TODAVIA NO IMPLEMENTADO" />
          <RoadmapPanel title={t(lang, "Webhooks de salida (PUSH)", "Output webhooks (PUSH)")} lines={["transcript.created", t(lang, "Outbox durable pendiente", "Durable outbox pending")]} state="TODAVIA NO IMPLEMENTADO" />
        </div>
        <div className="m2t-endpoints">
          <Endpoint method="GET" path="/runs" state="LIVE" />
          <Endpoint method="GET" path="/library/channels" state="LIVE" />
          <Endpoint method="GET" path="/events" state="LIVE" />
          <Endpoint method="GET" path="/metrics" state="LIVE" />
          <Endpoint method="GET" path="/metrics/cost" state="TODAVIA NO IMPLEMENTADO" />
        </div>
        <pre className="m2t-pre small">{`{"type":"utterance","index":1,"startSeconds":2,"endSeconds":9,"speaker":"A","text":"...","videoUrl":"https://...","title":"...","channelTitle":"...","languageCode":"en","languageConfidence":0.98}`}</pre>
      </section>
    );
  }

  function renderSettings() {
    const providerOptions = providers.length > 0 ? providers : [
      { id: "assemblyai", maxAudioBytes: 0, supportsDiarization: true },
      { id: "deepgram", maxAudioBytes: 0, supportsDiarization: true },
      { id: "openai_whisper", maxAudioBytes: 0, supportsDiarization: false },
    ] as ProviderCapability[];
    return (
      <section className="m2t-page">
        <PageIntro title={t(lang, "Ajustes", "Settings")} text={t(lang, "Configuración no secreta live. Gestión visual de claves queda limitada por seguridad.", "Live non-secret configuration. Visual key management is constrained for security.")} />
        <div className="m2t-settings-grid">
          <div className="m2t-panel">
            <div className="m2t-panel-head"><strong>{t(lang, "Proveedor", "Provider")}</strong><FeatureBadge state="LIVE" /></div>
            <div className="m2t-radio-grid">
              {providerOptions.map((provider) => (
                <button key={provider.id} data-active={settingsDraft.sttProvider === provider.id} onClick={() => setSettingsDraft((p) => ({ ...p, sttProvider: provider.id }))}>{provider.id}<small>{provider.supportsDiarization ? "diarization" : "no diarization"}</small></button>
              ))}
            </div>
            <div className="m2t-provider-options">
              <span>AssemblyAI: diarization · punctuation · PII redaction</span>
              <span>Deepgram: nova-2 · smart format · keywords</span>
              <span>Whisper: verbose_json · prompt · no diarization</span>
            </div>
          </div>
          <div className="m2t-panel">
            <div className="m2t-panel-head"><strong>{t(lang, "Comentarios", "Comments")}</strong><FeatureBadge state="LIVE" /></div>
            <label className="m2t-form-row"><span>commentsEnabled</span><select value={settingsDraft.commentsEnabled ?? "true"} onChange={(e) => setSettingsDraft((p) => ({ ...p, commentsEnabled: e.target.value }))}><option value="true">true</option><option value="false">false</option></select></label>
            <label className="m2t-form-row"><span>commentsMax</span><input value={settingsDraft.commentsMax ?? "100"} onChange={(e) => setSettingsDraft((p) => ({ ...p, commentsMax: e.target.value }))} /></label>
          </div>
          <div className="m2t-panel">
            <div className="m2t-panel-head"><strong>{t(lang, "Claves API", "API keys")}</strong><FeatureBadge state="PARCIAL" /></div>
            <p>{t(lang, "El runtime soporta multi-key por env/Doppler. Añadir/quitar secretos desde UI no se implementa para no filtrar credenciales.", "Runtime supports multi-key through env/Doppler. Add/remove secrets from UI is not implemented to avoid leaking credentials.")}</p>
          </div>
          <div className="m2t-panel">
            <div className="m2t-panel-head"><strong>{t(lang, "Almacenamiento", "Storage")}</strong><FeatureBadge state="PARCIAL" /></div>
            <p>{settings?.settingsPath}</p>
            <p>{t(lang, "Retención de audio existe por env/cleanup; política editable queda pendiente.", "Audio retention exists through env/cleanup; editable policy is pending.")}</p>
          </div>
        </div>
        <button className="m2t-button" onClick={() => void saveSettings()} disabled={busy === "settings"}>{busy === "settings" ? t(lang, "Guardando", "Saving") : t(lang, "Guardar cambios", "Save changes")}</button>
      </section>
    );
  }
}

function PageIntro({ title, text, badge }: { title: string; text: string; badge?: ReactNode }) {
  return (
    <div className="m2t-intro">
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {badge}
    </div>
  );
}

function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="m2t-section-head">
      <h2>{title}</h2>
      {right}
    </div>
  );
}

function Metric({ label, value, text, accent, danger, onClick, state }: { label: string; value: string; text: string; accent?: boolean; danger?: boolean; onClick?: () => void; state?: FeatureState }) {
  const body = (
    <>
      <div className="m2t-metric-label">{label}{state ? <FeatureBadge state={state} /> : null}</div>
      <div className={`m2t-metric-value ${accent ? "accent" : ""} ${danger ? "danger" : ""}`}>{value}</div>
      <div className="m2t-metric-text">{text}</div>
    </>
  );
  return onClick ? <button className="m2t-metric" onClick={onClick}>{body}</button> : <div className="m2t-metric">{body}</div>;
}

function HealthTile({ label, value, state }: { label: string; value: string; state: FeatureState }) {
  return (
    <div className="m2t-health">
      <span>{label}</span>
      <strong>{value}</strong>
      <FeatureBadge state={state} />
    </div>
  );
}

function RunsTable({ runs, lang, onOpenRun }: { runs: RunRecord[]; lang: Lang; onOpenRun: (run: RunRecord) => void }) {
  if (runs.length === 0) {
    return <EmptyState lang={lang} title={t(lang, "Sin actividad", "No activity")} text={t(lang, "Lanza una captura para ver la actividad live.", "Start a capture to see live activity.")} />;
  }
  return (
    <div className="m2t-table">
      <div className="m2t-tr head">
        <span>{t(lang, "FUENTE", "SOURCE")}</span>
        <span>{t(lang, "TIPO", "TYPE")}</span>
        <span>{t(lang, "CUÁNDO", "WHEN")}</span>
        <span>{t(lang, "ESTADO", "STATUS")}</span>
      </div>
      {runs.map((run) => (
        <button className="m2t-tr" key={run.runId} onClick={() => onOpenRun(run)}>
          <span><strong>{run.previewTitle ?? run.channelTitle ?? run.inputUrl ?? "Run"}</strong><small>{run.runId}</small></span>
          <span>{run.inputUrl?.startsWith("audio:") ? "AUDIO" : "YOUTUBE"}</span>
          <span>{formatDate(run.createdAt)}</span>
          <span><StatusPill status={run.status} /></span>
        </button>
      ))}
    </div>
  );
}

function RoadmapPanel({ title, lines, state }: { title: string; lines: string[]; state: FeatureState }) {
  return (
    <div className="m2t-panel">
      <div className="m2t-panel-head"><strong>{title}</strong><FeatureBadge state={state} /></div>
      {lines.map((line) => <p key={line}>{line}</p>)}
    </div>
  );
}

function Endpoint({ method, path, state }: { method: string; path: string; state: FeatureState }) {
  return (
    <div className="m2t-endpoint">
      <span>{method}</span>
      <code>{path}</code>
      <FeatureBadge state={state} />
    </div>
  );
}
