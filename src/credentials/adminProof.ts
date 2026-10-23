import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// The web server issues this only after same-origin + recent signed-session validation.
// A dedicated secret is held only by web + API, separately from machine API credentials.
export function signAdminProof(body: string | Uint8Array, secret: string, now = Date.now(), nonce = randomBytes(16).toString("hex")): string {
  const expires = Math.floor(now / 1000) + 30;
  const digest = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", secret).update(`m2t-credential-admin-v1\nPOST\n/provider-accounts\n${expires}\n${nonce}\n${digest}`).digest("hex");
  return `${expires}.${nonce}.${signature}`;
}
export function verifyAdminProof(body: string | Uint8Array, proof: string | undefined, secret: string | undefined, now = Date.now()): boolean {
  if (!secret || secret.length < 32 || !proof || !/^\d{10}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(proof)) return false;
  const [expiry, nonce, signature] = proof.split(".");
  const expires = Number(expiry);
  if (expires <= now / 1000 || expires > Math.floor(now / 1000) + 30) return false;
  const expected = signAdminProof(body, secret, (expires - 30) * 1000, nonce).split(".")[2]!;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature!, "hex"));
}

export function validateAdminProofSecret(): void {
  const secret = process.env.Y2T_CREDENTIAL_ADMIN_PROOF_SECRET?.trim();
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) throw new Error("credential_admin_secret_not_configured");
  const others = ["Y2T_API_KEY", "Y2T_INTAKE_API_KEY", "Y2T_CORTEX_TRANSCRIPT_READ_KEY", "Y2T_WEB_AUTH_SECRET", "Y2T_CREDENTIAL_MASTER_KEY"];
  let profiles: unknown;
  try { profiles = JSON.parse(process.env.Y2T_TRANSCRIPTION_INTAKE_PROFILES_JSON ?? "[]"); } catch { throw new Error("invalid_profile_configuration"); }
  const values: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string") values.push(value);
    else if (value && typeof value === "object") for (const child of Object.values(value)) collect(child);
  };
  collect(profiles);
  if ([...others.map((name) => process.env[name]?.trim()), ...values].includes(secret)) throw new Error("credential_admin_secret_must_be_distinct");
}
