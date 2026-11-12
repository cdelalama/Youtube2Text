import type { AppConfig, SttProviderId } from "../config/schema.js";
import type { TranscriptionProvider } from "../transcription/index.js";
import { definitiveRefusalOf, type DefinitiveRefusal } from "../transcription/errors.js";
import type { TranscriptJson, TranscriptionOptions } from "../transcription/types.js";
import { logWarn } from "../utils/logger.js";

/**
 * Optional bridge to the account registry for a pinned API run (D-029). The
 * pipeline calls it only after a definitive pre-acceptance refusal; the owner
 * decides whether another key or account may take over and records the move.
 * Absent (CLI, legacy keys), the pipeline behaves exactly as it always did.
 *
 * Every method that takes a credential id acts on THAT pin, never on whatever
 * the run currently uses: a recording keeps the pin it started with until its
 * own request is refused, even if a sibling recording moved the run meanwhile.
 */
export type PipelineFailover = {
  /** The pin a recording that starts now begins with. */
  credentialId(): string;
  /** Throws when that exact pin may no longer be used (locally revoked). */
  assertAvailable(credentialId: string): void;
  /**
   * Marks that pin as outstanding (a recording of this run still owns it)
   * until the returned function runs. Local revocation of an outstanding pin
   * must cancel the run even when the run itself has moved to another key.
   */
  track(credentialId: string): () => void;
  onDefinitiveRefusal(input: {
    credentialId: string;
    refusal: DefinitiveRefusal;
    /** Every pin this recording was already refused with, this one included. */
    refused: string[];
    /** Part of this recording was already accepted by this provider. */
    sameProviderOnly: boolean;
    /** The run was cancelled: record the key's health, decide nothing. */
    recordOnly: boolean;
  }):
    | { moved: true; config: AppConfig; credentialId: string }
    | { moved: false; reason: "off" | "no_candidate" | "record_only" | "error" }
    | { moved: false; reason: "recording_stopped"; nextProvider: SttProviderId };
};

// These messages are built from fixed codes only (provider, reason, HTTP
// status). They never include the provider's response text or the message of
// the error that caused them, which could echo part of a key.

/** Every listed key and account has been definitively refused; the job fails closed. */
export class FailoverExhaustedError extends Error {
  name = "FailoverExhaustedError";
  constructor(refusal: DefinitiveRefusal) {
    super(
      `Automatic account change stopped: ${refusal.provider} refused the request ` +
        `(${refusal.kind}, HTTP ${refusal.status}) and no other enabled, healthy key or account is left.`
    );
  }
}

/**
 * A partly transcribed recording was refused and the next candidate is another
 * service. Nothing took over: the recording stops rather than being paid twice
 * or mixing two services in one transcript.
 */
export class RecordingStoppedError extends Error {
  name = "RecordingStoppedError";
  constructor(refusal: DefinitiveRefusal, nextProvider: SttProviderId) {
    super(
      `Recording stopped: ${refusal.provider} refused the request (${refusal.kind}, HTTP ${refusal.status}) ` +
        `after part of this recording was already accepted by ${refusal.provider}, and the next account uses ` +
        `${nextProvider}. It was not re-sent automatically. Transcribing it again with ${nextProvider} repeats ` +
        "the parts already done, and those parts can be charged again."
    );
  }
}

/**
 * Defensive only: the registry excludes the keys a recording was refused with,
 * so it should never offer one again. If it does, stop instead of looping.
 */
export class FailoverRepeatedCandidateError extends Error {
  name = "FailoverRepeatedCandidateError";
  constructor(refusal: DefinitiveRefusal) {
    super(
      `Automatic account change stopped: ${refusal.provider} refused the request ` +
        `(${refusal.kind}, HTTP ${refusal.status}) and the only key offered next had already been refused for ` +
        "this recording."
    );
  }
}

/** Internal signal: this recording moved to another service before any of it was accepted. */
export class ServiceChangedSignal extends Error {
  constructor(public from: SttProviderId, public to: SttProviderId) {
    super(`Transcription service changed from ${from} to ${to}`);
  }
}

/** One engine = one service + one key. It is immutable; a move creates another. */
export type SttEngine = {
  config: AppConfig;
  provider: TranscriptionProvider;
  credentialId?: string;
  maxBytes?: number;
};

export type SttPieceOptions = Omit<TranscriptionOptions, "abortSignal" | "beforeRequest">;

export type SttItem = {
  /** The engine this recording uses now. */
  engine(): SttEngine;
  /** The recording is finished or abandoned: it no longer owns a pin. Idempotent. */
  close(): void;
  /**
   * Sends one piece of this recording. `acceptedPieces` is how many pieces of
   * the recording its current service already accepted.
   */
  transcribePiece(piecePath: string, pieceOptions: SttPieceOptions, acceptedPieces: number): Promise<TranscriptJson>;
};

export function createSttSession(input: {
  config: AppConfig;
  providerFactory: (config: AppConfig) => TranscriptionProvider;
  failover?: PipelineFailover;
  assertCredentialAvailable?: () => void;
  abortSignal?: AbortSignal;
  isCancelled: () => boolean;
}): { startItem(): SttItem } {
  const { failover } = input;
  const userMaxBytes =
    typeof input.config.maxAudioMB === "number" ? input.config.maxAudioMB * 1024 * 1024 : undefined;
  const makeEngine = (config: AppConfig, credentialId?: string): SttEngine => {
    const provider = input.providerFactory(config);
    const providerMaxBytes = provider.getCapabilities().maxAudioBytes;
    return {
      config,
      provider,
      credentialId,
      maxBytes:
        userMaxBytes !== undefined && providerMaxBytes !== undefined
          ? Math.min(userMaxBytes, providerMaxBytes)
          : userMaxBytes ?? providerMaxBytes,
    };
  };
  // One provider client per pin, shared by the recordings that use that pin.
  const engines = new Map<string, SttEngine>();
  const engineFor = (config: AppConfig, credentialId: string): SttEngine => {
    const cached = engines.get(credentialId);
    if (cached) return cached;
    const created = makeEngine(config, credentialId);
    engines.set(credentialId, created);
    return created;
  };
  // Built once, where the provider was always built, so a run without the
  // registry bridge keeps its single provider instance.
  const initial = failover ? engineFor(input.config, failover.credentialId()) : makeEngine(input.config);

  return {
    startItem(): SttItem {
      // The run's pin changes only through a move made in this session, whose
      // engine is therefore already here.
      let engine = (failover && engines.get(failover.credentialId())) || initial;
      // The recording owns its pin from here until close(), between pieces too.
      const hold = (owned: SttEngine) => (failover && owned.credentialId ? failover.track(owned.credentialId) : undefined);
      let release = hold(engine);
      // Finite by construction: a key refused for this recording is never tried
      // for it again, so the loop below ends when the registry runs out of keys.
      const refused = new Set<string>();

      /**
       * Another key or account is used ONLY when the provider definitively
       * refused the request before accepting it and the registry authorised and
       * recorded the move. A timeout, network failure, 5xx or any
       * post-acceptance failure is rethrown untouched: the first provider may
       * still bill, so the piece is never sent elsewhere.
       */
      const transcribePiece = async (
        piecePath: string,
        pieceOptions: SttPieceOptions,
        acceptedPieces: number
      ): Promise<TranscriptJson> => {
        const service = engine.config.sttProvider;
        for (;;) {
          const attempt = engine;
          const credentialId = attempt.credentialId;
          // Guards and revocation tracking are bound to THIS attempt's pin for
          // its whole life, including retries and polling inside the adapter.
          const guard = failover && credentialId
            ? () => failover.assertAvailable(credentialId)
            : input.assertCredentialAvailable;
          try {
            guard?.();
            return await attempt.provider.transcribe(piecePath, {
              ...pieceOptions,
              abortSignal: input.abortSignal,
              beforeRequest: guard,
            });
          } catch (error) {
            const refusal = definitiveRefusalOf(error);
            if (!refusal || !failover || !credentialId) throw error;
            refused.add(credentialId);
            // The definitive answer is always recorded, whatever happens next.
            const decision = failover.onDefinitiveRefusal({
              credentialId,
              refusal,
              refused: [...refused],
              sameProviderOnly: acceptedPieces > 0,
              recordOnly: input.isCancelled(),
            });
            if (!decision.moved) {
              if (decision.reason === "no_candidate") throw new FailoverExhaustedError(refusal);
              if (decision.reason === "recording_stopped") {
                throw new RecordingStoppedError(refusal, decision.nextProvider);
              }
              throw error;
            }
            if (refused.has(decision.credentialId)) throw new FailoverRepeatedCandidateError(refusal);
            const previous = release;
            engine = engineFor(decision.config, decision.credentialId);
            release = hold(engine);
            previous?.();
            const next = engine.config.sttProvider;
            logWarn(
              `Automatic account change: ${refusal.provider} refused the request (${refusal.kind}, HTTP ${refusal.status}); ` +
                `continuing with ${next}${next === service ? "" : " (transcription service changed)"}`
            );
            // Limits, cost rate and caps are per service: plan the recording again.
            if (next !== service) throw new ServiceChangedSignal(service, next);
          }
        }
      };

      return { engine: () => engine, transcribePiece, close: () => { release?.(); release = undefined; } };
    },
  };
}
