import type { ReactNode } from "react";
import "./globals.css";
import Link from "next/link";
import { apiGetJson } from "../lib/api";
import type { components } from "../lib/apiTypes.gen";

export const metadata = {
  title: "Media2Text Admin",
  description: "Local-first admin UI for Media2Text",
};

type HealthResponse = components["schemas"]["HealthResponse"];

async function getApiVersion(): Promise<string | undefined> {
  try {
    const health = await apiGetJson<HealthResponse>("/health");
    return typeof health.version === "string" && health.version.length > 0 ? health.version : undefined;
  } catch {
    return undefined;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const apiVersion = await getApiVersion();
  return (
    <html lang="en">
      <body>
        <div className="container">
          <div className="nav">
            <Link href="/"><strong>Media2Text</strong></Link>
            <Link href="/">Runs</Link>
            <Link href="/library">Library</Link>
            <Link href="/watchlist">Watchlist</Link>
            <Link href="/settings">Settings</Link>
            <span className="muted mlAuto">
              API: {process.env.NEXT_PUBLIC_Y2T_API_BASE_URL ?? "http://127.0.0.1:8787"}
              {apiVersion ? ` (v${apiVersion})` : ""}
            </span>
          </div>
          <div className="spacer14" />
          {children}
        </div>
      </body>
    </html>
  );
}
