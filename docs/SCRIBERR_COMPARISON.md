# Scriberr vs Media2Text/youtube2text - Feature Comparison

> Analysis date: 2026-03-02
> Last reviewed: 2026-06-19
> Scriberr repo: https://github.com/rishikanthc/Scriberr (v1.2.0, 2,247 stars)
> Media2Text/youtube2text version: v0.36.4

## Philosophy & Focus

| | **Scriberr** | **Media2Text/youtube2text** |
|---|---|---|
| **Focus** | Generic local audio transcription (meetings, voice notes, podcasts) | YouTube channel/playlist transcription + local audio |
| **Stack** | Go (backend) + React/Vite (frontend) + Python (ML models) | TypeScript/Node (backend) + Next.js (frontend) |
| **STT** | **Local**: NVIDIA Parakeet, Canary, Whisper (GPU/CPU) | **Cloud**: AssemblyAI, Deepgram, OpenAI Whisper API |
| **Database** | SQLite (GORM ORM) | Filesystem (JSON/JSONL on disk) |
| **Auth** | JWT + API keys | API key (X-API-Key header) |
| **Deployment** | Docker (CPU + CUDA variants), Homebrew | Docker, tagged images, Doppler secrets |

## Features Scriberr Has That Media2Text Does NOT

### 1. Chat With Transcriptions (LLM Integration)

**What it does**: Integrates with Ollama (local) and OpenAI-compatible APIs to allow users to ask questions about transcribed content directly within the app.

**Implementation in Scriberr**:
- Provider-agnostic `llm.Service` interface with `ChatCompletion` + `ChatCompletionStream`
- Two adapters: `internal/llm/ollama.go` and `internal/llm/openai.go`
- SSE streaming for real-time responses
- Chat history persisted in SQLite
- UI: embedded chat panel in transcript view

**Key endpoints**:
- `POST /api/v1/chat` — send a message, get streamed LLM response
- Model selection per conversation
- Temperature and context window configuration

**Relevance to Media2Text**: Very high. Transforms the tool from a "transcriptor" into an "analysis platform". A `POST /library/.../chat` endpoint with Ollama/OpenAI would let users interrogate video content. Fits naturally into the RAG-pipeline vision.

### 2. Automatic Summaries (LLM-Generated)

**What it does**: Generates comprehensive summaries of transcriptions using LLMs, with streaming output.

**Implementation in Scriberr**:
- `POST /api/v1/summarize` with `model`, `content`, `transcription_id`
- Streams via `text/plain; charset=utf-8` with chunked transfer
- 60-minute timeout for large transcripts
- Persists latest summary per transcription in DB
- Template system for different summary styles

**Relevance to Media2Text**: High. For channels with many videos, auto-summaries would enable quick scanning without reading full transcripts. Could generate `.summary.md` sidecar files.

### 3. Notes & Annotations

**What it does**: Users can highlight transcript fragments and attach notes tied to specific time ranges and word positions.

**Implementation in Scriberr**:
- `Note` model with `startWordIndex`, `endWordIndex`, `startTime`, `endTime`, `quote`, `content`
- Full CRUD: `GET/POST /api/v1/transcription/{id}/notes`, `PATCH/DELETE /api/v1/transcription/{id}/notes/{noteId}`
- UI: highlight text → annotate → review notes while listening

**Relevance to Media2Text**: Medium. Adds editorial value. Would require a `notes` sidecar file per video (e.g., `<videoId>.notes.json`) to stay filesystem-based.

### 4. Folder Watcher (Dropzone)

**What it does**: Monitors a directory and automatically transcribes any audio file dropped into it.

**Implementation in Scriberr**:
- `internal/dropzone/dropzone.go` using `fsnotify` library
- Watches `data/dropzone/` directory
- On new file: creates job entry → enqueues to task queue → transcribes
- Zero manual intervention required

**Relevance to Media2Text**: Medium. Complements the existing `POST /audio` upload endpoint. A "hot folder" mode would enable integration with file sync tools (Syncthing, rsync, etc.) without API calls.

### 5. 100% Local Transcription (No Cloud API)

**What it does**: Runs Whisper, NVIDIA Parakeet, and Canary models locally — no audio leaves the machine.

**Implementation in Scriberr**:
- Python-based ML pipeline managed via UV (Python package manager)
- Adapters: `parakeet_adapter.go`, `canary_adapter.go`, `openai_adapter.go` (local Whisper)
- GPU support: separate Docker images for CUDA (Pascal through Blackwell)
- Audio preprocessing: FFmpeg conversion to mono 16kHz WAV
- Model auto-download on first run

**Relevance to Media2Text**: Depends on hardware. The NAS has no GPU, but dev-vm could run `faster-whisper` or `whisper.cpp`. Would eliminate per-minute costs for high-volume transcription. Could be added as a fourth provider behind the existing `TranscriptionProvider` interface.

### 6. Speaker Mapping (Rename Speakers)

**What it does**: Allows renaming generic speaker labels ("Speaker 1") to real names ("Pablo Gil").

**Implementation in Scriberr**:
- `internal/api/speaker_mapping_handlers.go`
- Persisted in database per transcription
- Applied at display time (original diarization preserved)

**Relevance to Media2Text**: High value, low effort. Diarization already identifies speakers. Adding a mapping file (e.g., `<videoId>.speakers.json`) and a `PATCH /library/.../videos/{basename}/speakers` endpoint would dramatically improve readability.

### 7. Transcription Profiles

**What it does**: Saved configurations (model, language, parameters) that can be reused for different content types.

**Implementation in Scriberr**: Configurable per-job with presets visible in settings UI.

**Relevance to Media2Text**: Medium. Currently `_settings.json` holds global defaults. Per-channel profiles (e.g., "Spanish finance channel" vs "English tech channel") would reduce manual configuration.

### 8. Built-in Audio Recorder

**What it does**: Record audio directly in the web UI, then transcribe immediately.

**Relevance to Media2Text**: Low. The tool is YouTube-first. Local audio upload already covers most use cases.

### 9. PWA (Progressive Web App)

**What it does**: Installable as a native-feeling app on desktop and mobile with offline caching.

**Relevance to Media2Text**: Low effort (Next.js manifest + service worker), nice-to-have.

## Features Media2Text Has That Scriberr Does NOT

| Feature | Details |
|---|---|
| **Native YouTube support** | Channel/playlist enumeration via yt-dlp, metadata extraction, comments |
| **Multi-key load balancer** | Round-robin with failover across multiple API keys per provider |
| **Scheduler + Watchlist** | Automatic incremental transcription of followed channels (cron) |
| **Webhooks** | Callback to external systems (n8n, Cortex) on run completion |
| **Pipeline Integration API** | `videoIds`, `beforeDate`, catalog endpoint for external orchestration |
| **JSONL/CSV export** | Optimized formats for RAG ingestion and spreadsheet analysis |
| **Comprehensive security audit** | All P0/P1/P2 fixes (path traversal, SSRF, timing attacks, symlink) |
| **Prometheus metrics** | `/metrics` endpoint for production monitoring |
| **152 tests** | Extensive coverage including security edge cases |
| **Multi-provider with runtime switching** | AssemblyAI, Deepgram, OpenAI — switch per run |
| **Language auto-detection chain** | yt-dlp metadata → subtitles → auto-captions → ALD fallback |
| **Catalog caching** | Pre-computed video lists without yt-dlp re-enumeration |
| **Run planning** | `POST /runs/plan` for dry-run estimation before transcription |
| **Atomic file writes** | Crash-safe persistence (temp + rename pattern) |
| **Retention cleanup** | Automatic old run/audio purging |

## Feature Mining Priority

| Priority | Feature | Effort | Impact | Notes |
|---|---|---|---|---|
| **1** | Chat with transcriptions (Ollama/OpenAI) | Medium-High | Very High | Transforms from "transcriptor" to "analysis tool" |
| **2** | Speaker mapping (rename speakers) | Low | High | Sidecar `.speakers.json` + PATCH endpoint |
| **3** | Folder watcher (dropzone) | Low | Medium | `fsnotify` or `chokidar` on a watched directory |
| **4** | Automatic summaries (LLM) | Medium | High | `.summary.md` sidecar, streaming SSE |
| **5** | Local transcription provider | High | Medium | `faster-whisper` or `whisper.cpp`, needs CPU/GPU |
| **6** | Transcription profiles | Low | Medium | Per-channel config override in watchlist |
| **7** | Notes & annotations | Medium | Low-Medium | Sidecar `.notes.json`, UI changes |
| **8** | PWA | Low | Low | Next.js manifest + service worker |

## Implementation Considerations

### Chat / Summaries (LLM Integration)
- Add `llm/` module with provider interface (Ollama adapter, OpenAI-compatible adapter)
- New endpoints: `POST /library/.../chat`, `POST /library/.../summarize`
- SSE streaming (already proven in the codebase)
- Could reuse Doppler for LLM API keys (OpenAI) or detect local Ollama
- Summary output as `.summary.md` sidecar alongside transcripts

### Speaker Mapping
- New file: `<videoId>.speakers.json` → `{ "Speaker 1": "Pablo Gil", "Speaker 2": "Guest" }`
- Endpoint: `PATCH /library/channels/{dir}/videos/{basename}/speakers`
- Formatters apply mapping at render time (preserve original diarization)
- Low risk: no changes to core pipeline

### Folder Watcher
- Use `chokidar` (Node.js) to watch a configurable directory (e.g., `audio/dropzone/`)
- On new file: auto-create audio upload job → enqueue to pipeline
- Config: `Y2T_DROPZONE_PATH`, `Y2T_DROPZONE_ENABLED=true/false`
- Debounce to handle partial writes

### Local Transcription
- New provider implementing `TranscriptionProvider` interface
- Shell out to `faster-whisper` or `whisper.cpp` binary
- Return same utterance format (speaker, start_ms, end_ms, text)
- Diarization: would need `pyannote` or similar (complex)
- Consider: transcription-only (no diarization) as simpler first step

## Summary

Scriberr is oriented toward **"personal audio tool with local ML"** while Media2Text/youtube2text is a **"production pipeline for YouTube with cloud APIs"**. They are complementary rather than competitive.

The highest-value features to adopt are **LLM integration** (chat + summaries) and **speaker mapping** — they transform Media2Text from a transcription engine into a content analysis platform, which aligns with the RAG-pipeline roadmap.
