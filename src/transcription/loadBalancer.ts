import { logWarn } from "../utils/logger.js";
import type { SttProviderId } from "../config/schema.js";
import type { ProviderCapabilities, TranscriptionProvider } from "./provider.js";
import type { TranscriptJson, TranscriptionOptions } from "./types.js";

export type LoadBalancerOptions = {
  failureThreshold: number;
  cooldownMs: number;
};

type KeyState = {
  key: string;
  failures: number;
  disabledUntil: number;
};

export class MultiKeyProvider implements TranscriptionProvider {
  name: SttProviderId;
  private states: KeyState[];
  private providers = new Map<string, TranscriptionProvider>();
  private nextIndex = 0;

  constructor(
    providerId: SttProviderId,
    private providerLabel: string,
    keys: string[],
    private createProvider: (key: string) => TranscriptionProvider,
    private capabilities: ProviderCapabilities,
    private options: LoadBalancerOptions
  ) {
    this.name = providerId;
    this.states = keys.map((key) => ({
      key,
      failures: 0,
      disabledUntil: 0,
    }));
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  async getAccount(): Promise<Record<string, unknown>> {
    const provider = this.pickAvailableProvider();
    if (!provider.getAccount) {
      throw new Error(`${this.providerLabel} provider does not support credits check`);
    }
    return await provider.getAccount();
  }

  async transcribe(
    audioPath: string,
    opts: TranscriptionOptions
  ): Promise<TranscriptJson> {
    let lastError: unknown;
    for (let attempts = 0; attempts < this.states.length; attempts += 1) {
      const state = this.pickAvailableState();
      if (!state) break;
      const provider = this.getProvider(state.key);
      try {
        const result = await provider.transcribe(audioPath, opts);
        state.failures = 0;
        return result;
      } catch (error) {
        lastError = error;
        this.markFailure(state);
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error(`No ${this.providerLabel} keys available (all in cooldown)`);
  }

  private pickAvailableProvider(): TranscriptionProvider {
    const state = this.pickAvailableState();
    if (!state) {
      throw new Error(`No ${this.providerLabel} keys available (all in cooldown)`);
    }
    return this.getProvider(state.key);
  }

  private pickAvailableState(): KeyState | undefined {
    const now = Date.now();
    for (let offset = 0; offset < this.states.length; offset += 1) {
      const idx = (this.nextIndex + offset) % this.states.length;
      const state = this.states[idx];
      if (!state) continue;
      if (state.disabledUntil > now) continue;
      this.nextIndex = (idx + 1) % this.states.length;
      return state;
    }
    return undefined;
  }

  private getProvider(key: string): TranscriptionProvider {
    const cached = this.providers.get(key);
    if (cached) return cached;
    const created = this.createProvider(key);
    this.providers.set(key, created);
    return created;
  }

  private markFailure(state: KeyState) {
    state.failures += 1;
    if (state.failures < this.options.failureThreshold) return;
    state.failures = 0;
    state.disabledUntil = Date.now() + this.options.cooldownMs;
    logWarn(
      `${this.providerLabel} key ${maskKey(state.key)} disabled for ${Math.round(
        this.options.cooldownMs / 1000
      )}s after consecutive failures.`
    );
  }
}

function maskKey(key: string): string {
  if (key.length <= 4) return "***";
  return `${key.slice(0, 4)}...`;
}
