import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { AppConfig } from "../config/schema.js";
import type { RunManager } from "../api/runManager.js";
import { json } from "../api/http.js";
import { CredentialError, CredentialStore, legacyKeys, PROVIDERS } from "./store.js";
import { verifyAdminProof } from "./adminProof.js";
import { probeCredential } from "./probe.js";

const provider = z.enum(PROVIDERS);
const id = z.string().uuid();
const label = z.string().trim().min(1).max(80).refine((s) => !/[\x00-\x1f\x7f]/.test(s));
const token = z.string().trim().min(8).max(4096).regex(/^[\x21-\x7e]+$/);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), provider, label, token }).strict(),
  z.object({ action: z.literal("import_legacy"), provider, label, legacyIndex: z.number().int().min(0).max(100) }).strict(),
  z.object({ action: z.literal("rename"), accountId: id, label }).strict(),
  z.object({ action: z.literal("enable"), accountId: id, enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("add_key"), accountId: id, token }).strict(),
  z.object({ action: z.literal("use_key"), accountId: id, credentialId: id }).strict(),
  z.object({ action: z.literal("revoke"), accountId: id, credentialId: id }).strict(),
  z.object({ action: z.literal("select"), accountId: id }).strict(),
  z.object({ action: z.literal("use_legacy"), provider }).strict(),
  z.object({ action: z.literal("probe"), accountId: id }).strict(),
  z.object({ action: z.literal("probe_unsaved"), provider, token }).strict(),
]);

export function credentialRoutes(store: CredentialStore | undefined, baseConfig: AppConfig, manager: RunManager,
  effectiveConfig: () => AppConfig, probe = probeCredential) {
  let probeCount = 0;
  let probeWindow = 0;
  const usedProofs = new Map<string, number>();
  function snapshot() {
    const accounts = store?.list() ?? [];
    const activeProvider = effectiveConfig().sttProvider;
    const selected = accounts.find((account) => account.selected && account.provider === activeProvider);
    return { configured: Boolean(store), activeProvider, selectedAccountId: selected?.id ?? null, accounts,
      legacy: PROVIDERS.map((provider) => ({ provider, keys: legacyKeys(baseConfig, provider).map((key) => `••••${key.slice(-4)}`),
        selected: !accounts.some((account) => account.provider === provider && account.selected) })),
      selectionReady: selected ? selected.enabled && selected.keys.some((key) => key.id === selected.currentCredentialId && !key.revoked)
        : legacyKeys(baseConfig, activeProvider).length > 0 };
  }
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("cache-control", "no-store");
    try {
      if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")) {
        json(res, 403, { error: "credential_admin_loopback_only" }); return;
      }
      // Never inherit the optional development bypass for this sensitive surface.
      if (!process.env.Y2T_API_KEY?.trim()) { json(res, 503, { error: "api_auth_not_configured" }); return; }
      if (req.method === "GET") { json(res, 200, snapshot()); return; }
      if (req.method !== "POST") { json(res, 405, { error: "method_not_allowed" }); return; }
      if (!store) { json(res, 503, { error: "credential_store_not_configured" }); return; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > 16_384) { json(res, 413, { error: "payload_too_large" }); return; }
        chunks.push(buffer);
      }
      const raw = Buffer.concat(chunks);
      const proof = req.headers["x-m2t-admin-proof"];
      const now = Date.now();
      for (const [nonce, expiry] of usedProofs) if (expiry <= now) usedProofs.delete(nonce);
      if (!verifyAdminProof(raw, typeof proof === "string" ? proof : undefined, process.env.Y2T_CREDENTIAL_ADMIN_PROOF_SECRET?.trim(), now)
        || usedProofs.has(proof as string) || usedProofs.size >= 1024) {
        json(res, 403, { error: "recent_auth_required" }); return;
      }
      usedProofs.set(proof as string, now + 31_000);
      let input: unknown;
      try { input = JSON.parse(raw.toString("utf8")); } catch { json(res, 400, { error: "invalid_request" }); return; }
      const parsed = actionSchema.safeParse(input);
      if (!parsed.success) { json(res, 400, { error: "invalid_request" }); return; }
      const action = parsed.data;
      if (action.action === "probe" || action.action === "probe_unsaved") {
        if (Date.now() > probeWindow + 60_000) { probeWindow = Date.now(); probeCount = 0; }
        if (++probeCount > 6) { res.setHeader("retry-after", "60"); json(res, 429, { error: "probe_rate_limited" }); return; }
        const saved = action.action === "probe" ? store.probeKey(action.accountId) : undefined;
        const check = saved ? await probe(saved.pin.provider, saved.token)
          : await probe((action as Extract<typeof action, { action: "probe_unsaved" }>).provider,
            (action as Extract<typeof action, { action: "probe_unsaved" }>).token);
        if (saved) store.recordCheck(saved.pin, check);
        json(res, 200, { ...snapshot(), check }); return;
      }
      let accountId: string | undefined;
      let cancelledRuns: number | undefined;
      switch (action.action) {
        case "create": accountId = store.create(action.provider, action.label, [action.token]); break;
        case "import_legacy": {
          const key = legacyKeys(baseConfig, action.provider)[action.legacyIndex];
          if (!key) throw new CredentialError("legacy_credential_missing");
          accountId = store.create(action.provider, action.label, [key]); break;
        }
        case "rename": store.rename(action.accountId, action.label); break;
        case "enable": store.enable(action.accountId, action.enabled); break;
        case "add_key": store.addKey(action.accountId, action.token); break;
        case "use_key": store.useKey(action.accountId, action.credentialId); break;
        case "select": store.select(action.accountId); break;
        case "use_legacy": store.useLegacy(action.provider); break;
        case "revoke":
          store.revoke(action.accountId, action.credentialId);
          cancelledRuns = manager.revokeCredential(action.credentialId); break;
      }
      json(res, 200, { ...snapshot(), accountId, cancelledRuns });
    } catch (error) {
      // Never propagate SQLite errors, vendor bodies, token-bearing exceptions, or raw input.
      json(res, error instanceof CredentialError ? 409 : 500,
        { error: error instanceof CredentialError ? error.code : "credential_operation_failed" });
    }
  };
}
