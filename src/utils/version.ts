import { promises as fs } from "node:fs";
import { join } from "node:path";

let cachedVersion: string | undefined;

export async function getBuildVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;

  const envVersion = process.env.npm_package_version?.trim();
  if (envVersion) {
    cachedVersion = envVersion;
    return cachedVersion;
  }

  try {
    const raw = await fs.readFile(join(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    cachedVersion = parsed.version?.trim() || "unknown";
  } catch {
    cachedVersion = "unknown";
  }
  return cachedVersion;
}
