export type YtDlpFailureKind = "access" | "unavailable" | "transient" | "unknown";

export type YtDlpFailureReason =
  | "members_only"
  | "private"
  | "age_restricted"
  | "removed"
  | "geo_restricted"
  | "login_required"
  | "missing_js_runtime"
  | "rate_limited"
  | "unknown";

export type YtDlpFailureInfo = {
  kind: YtDlpFailureKind;
  reason: YtDlpFailureReason;
  retryable: boolean;
  summary: string;
  hint?: string;
};

export class YtDlpError extends Error {
  constructor(
    public info: YtDlpFailureInfo,
    public details: { stderr: string; stdout: string }
  ) {
    super(info.summary);
    this.name = "YtDlpError";
  }
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function firstNonEmptyLine(text: string): string | undefined {
  for (const line of normalize(text).split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

export function parseYtDlpFailure(output: {
  stderr?: string;
  stdout?: string;
}): YtDlpFailureInfo | undefined {
  const stderr = normalize(output.stderr ?? "");
  const stdout = normalize(output.stdout ?? "");
  const text = `${stderr}\n${stdout}`.toLowerCase();

  const hint = undefined;

  if (
    text.includes("no supported javascript runtime could be found") ||
    text.includes("js challenge providers:") ||
    text.includes("n challenge solving failed") ||
    text.includes("yt-dlp-ejs")
  ) {
    return {
      kind: "unavailable",
      reason: "missing_js_runtime",
      retryable: false,
      summary: "yt-dlp: YouTube EJS runtime is not ready",
      hint:
        'Install yt-dlp with default extras (`python3 -m pip install -U "yt-dlp[default]"`) and enable a supported JavaScript runtime. The Docker API image configures this internally.',
    };
  }

  if (
    text.includes("members-only") ||
    text.includes("members only") ||
    text.includes("join this channel to get access") ||
    text.includes("available to this channel's members")
  ) {
    return {
      kind: "access",
      reason: "members_only",
      retryable: false,
      summary: "yt-dlp: members-only video (not supported; skipping)",
      hint,
    };
  }

  if (text.includes("private video") || text.includes("this video is private")) {
    return {
      kind: "access",
      reason: "private",
      retryable: false,
      summary: "yt-dlp: private video (not accessible; skipping)",
      hint,
    };
  }

  if (
    text.includes("sign in to confirm your age") ||
    text.includes("age-restricted") ||
    text.includes("age restricted")
  ) {
    return {
      kind: "access",
      reason: "age_restricted",
      retryable: false,
      summary: "yt-dlp: age-restricted video (not accessible; skipping)",
      hint,
    };
  }

  if (
    text.includes("video unavailable") ||
    text.includes("this video is unavailable") ||
    text.includes("does not exist") ||
    text.includes("not found")
  ) {
    return {
      kind: "unavailable",
      reason: "removed",
      retryable: false,
      summary: "yt-dlp: video unavailable/removed",
      hint,
    };
  }

  if (text.includes("this video is not available in your country")) {
    return {
      kind: "access",
      reason: "geo_restricted",
      retryable: false,
      summary: "yt-dlp: geo-restricted video (not accessible; skipping)",
      hint,
    };
  }

  if (
    text.includes("http error 403") ||
    text.includes("403 forbidden") ||
    text.includes("sign in") ||
    text.includes("login required")
  ) {
    return {
      kind: "access",
      reason: "login_required",
      retryable: false,
      summary: "yt-dlp: access denied (login required / 403); skipping",
      hint,
    };
  }

  if (
    text.includes("http error 429") ||
    text.includes("too many requests") ||
    text.includes("rate limit")
  ) {
    return {
      kind: "transient",
      reason: "rate_limited",
      retryable: true,
      summary: "yt-dlp: rate limited (429); retrying may succeed",
      hint,
    };
  }

  if (
    text.includes("timed out") ||
    text.includes("timeout") ||
    text.includes("connection reset") ||
    text.includes("econnreset") ||
    text.includes("temporary failure") ||
    text.includes("tls")
  ) {
    return {
      kind: "transient",
      reason: "unknown",
      retryable: true,
      summary: "yt-dlp: transient network error; retrying may succeed",
      hint,
    };
  }

  const line =
    firstNonEmptyLine(output.stderr ?? "") ??
    firstNonEmptyLine(output.stdout ?? "");

  if (!line && !hint) return undefined;

  return {
    kind: "unknown",
    reason: "unknown",
    retryable: true,
    summary: line ? `yt-dlp: ${line}` : "yt-dlp: failed",
    hint,
  };
}
