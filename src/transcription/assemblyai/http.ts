import { readFile } from "node:fs/promises";
import {
  InsufficientCreditsError,
  ProviderHttpError,
  sanitizeProviderErrorText,
} from "../errors.js";
import { fetchWithTimeout, isAbortError } from "../../utils/fetch.js";

const API_BASE = "https://api.assemblyai.com/v2";

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
    if (isAbortError(error)) {
      throw new Error("AssemblyAI request timed out");
    }
    throw error;
  }
  if (!response.ok) {
    const text = await response.text();
    if (isInsufficientCredits(response.status, text)) {
      throw new InsufficientCreditsError(
        `AssemblyAI insufficient credits: ${sanitizeProviderErrorText(text, [apiKey])}`
      );
    }
    const safe = sanitizeProviderErrorText(text, [apiKey]);
    throw new ProviderHttpError("AssemblyAI", response.status, safe);
  }
  return (await response.json()) as T;
}

export async function uploadFile(
  apiKey: string,
  audioPath: string,
  timeoutMs?: number
): Promise<{ upload_url: string }> {
  const buffer = await readFile(audioPath);
  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_BASE}/upload`, {
      method: "POST",
      headers: { Authorization: apiKey },
      body: buffer,
    }, timeoutMs);
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("AssemblyAI upload timed out");
    }
    throw error;
  }
  if (!response.ok) {
    const text = await response.text();
    if (isInsufficientCredits(response.status, text)) {
      throw new InsufficientCreditsError(
        `AssemblyAI insufficient credits: ${sanitizeProviderErrorText(text, [apiKey])}`
      );
    }
    const safe = sanitizeProviderErrorText(text, [apiKey]);
    throw new ProviderHttpError("AssemblyAI upload", response.status, safe);
  }
  return (await response.json()) as { upload_url: string };
}
