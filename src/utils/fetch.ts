export function isAbortError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as Error).name === "AbortError";
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs?: number
): Promise<Response> {
  if (!timeoutMs || timeoutMs <= 0) {
    return await fetch(url, init);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
