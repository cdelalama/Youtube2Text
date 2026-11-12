import { readFile } from "node:fs/promises";
import {
  InsufficientCreditsError,
  ProviderError,
  ProviderHttpError,
} from "../errors.js";
import { fetchWithTimeout, isAbortError } from "../../utils/fetch.js";

const API_BASE = "https://api.assemblyai.com/v2";
const PROVIDER = "AssemblyAI";
const PROVIDER_UPLOAD = "AssemblyAI upload";

// The response body is read only to choose a category. None of its text is
// kept: AssemblyAI answers errors with free text, not with a machine code.

function isInsufficientCredits(status: number, body: string): boolean {
  if (status === 402) return true;
  const text = body.toLowerCase();
  return (
    text.includes("insufficient credits") ||
    text.includes("out of credits") ||
    text.includes("credit balance") ||
    text.includes("insufficient") && text.includes("credit") ||
    text.includes("quota exceeded")
  );
}

/** The documented refusal of POST /v2/transcript when the balance is negative. */
function isNegativeBalance(status: number, body: string): boolean {
  return status === 400 && /account balance is negative/i.test(body);
}

function httpError(provider: string, status: number, body: string): ProviderError {
  if (isInsufficientCredits(status, body)) return new InsufficientCreditsError(provider, status);
  return new ProviderHttpError(provider, status,
    isNegativeBalance(status, body) ? { category: "payment-or-quota" } : {});
}

function requestFailure(provider: string, error: unknown): Error {
  return new ProviderError({ provider, category: isAbortError(error) ? "timeout" : "network" });
}

async function readJson<T>(provider: string, response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    // The request was answered with a 2xx; an unreadable body is not a refusal.
    throw new ProviderError({ provider, category: "invalid-response", status: response.status });
  }
}

export async function requestJson<T>(
  apiKey: string,
  path: string,
  init: RequestInit,
  timeoutMs?: number
): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    }, timeoutMs);
  } catch (error) {
    if (init.signal?.aborted) throw new Error("Transcription cancelled locally");
    throw requestFailure(PROVIDER, error);
  }
  if (!response.ok) {
    throw httpError(PROVIDER, response.status, await response.text().catch(() => ""));
  }
  return await readJson<T>(PROVIDER, response);
}

export async function uploadFile(
  apiKey: string,
  audioPath: string,
  timeoutMs?: number,
  signal?: AbortSignal,
  beforeRequest?: () => void
): Promise<{ upload_url: string }> {
  const buffer = await readFile(audioPath);
  // Checked outside the request block so that a local cancellation or a
  // revoked key is never reported as a provider failure.
  if (signal?.aborted) throw new Error("Transcription cancelled locally");
  beforeRequest?.();
  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_BASE}/upload`, {
      method: "POST",
      signal,
      headers: { Authorization: apiKey },
      body: buffer,
    }, timeoutMs);
  } catch (error) {
    if (signal?.aborted) throw new Error("Transcription cancelled locally");
    throw requestFailure(PROVIDER_UPLOAD, error);
  }
  if (!response.ok) {
    throw httpError(PROVIDER_UPLOAD, response.status, await response.text().catch(() => ""));
  }
  return await readJson<{ upload_url: string }>(PROVIDER_UPLOAD, response);
}
