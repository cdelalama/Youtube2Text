import type { SttProviderId } from "../config/schema.js";
import type { AccessCheck } from "./store.js";

/** Authentication-only GETs. Never send audio, follow redirects, or retain vendor bodies. */
export async function probeCredential(provider: SttProviderId, token: string, fetchFn = fetch): Promise<AccessCheck> {
  const checkedAt = new Date().toISOString();
  const url = provider === "assemblyai" ? "https://api.assemblyai.com/v2/transcript?limit=1"
    : provider === "deepgram" ? "https://api.deepgram.com/v1/projects" : "https://api.openai.com/v1/models";
  try {
    const response = await fetchFn(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { authorization: provider === "assemblyai" ? token : `${provider === "deepgram" ? "Token" : "Bearer"} ${token}` } });
    await response.body?.cancel();
    return { checkedAt, state: response.ok ? "accepted" : response.status === 401 ? "rejected"
      : response.status === 403 ? "permission_unknown" : "unavailable" };
  } catch { return { checkedAt, state: "unavailable" }; }
}
