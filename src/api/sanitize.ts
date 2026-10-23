import type { AppConfig } from "../config/schema.js";
import { configSchemaBase } from "../config/schema.js";

export function sanitizeConfigOverrides(
  overrides: Partial<AppConfig> | undefined
): Partial<AppConfig> {
  if (!overrides) return {};
  const copy: Record<string, unknown> = { ...overrides };
  for (const key of [
    "__proto__",
    "prototype",
    "constructor",
    "credentialRegistryEnabled",
    "assemblyAiApiKey",
    "assemblyAiApiKeys",
    "deepgramApiKey",
    "deepgramApiKeys",
    "openaiApiKey",
    "ytDlpPath",
  ]) {
    if (Object.prototype.hasOwnProperty.call(copy, key)) {
      delete (copy as Record<string, unknown>)[key];
    }
  }
  const parsed = configSchemaBase.partial().safeParse(copy);
  // Zod 4 applies nested defaults even inside partial objects. Overrides must
  // never reset the effective provider, credential pin or configured paths.
  return parsed.success
    ? Object.fromEntries(Object.entries(parsed.data).filter(([key]) =>
      Object.prototype.hasOwnProperty.call(copy, key) && copy[key] !== undefined))
    : {};
}
