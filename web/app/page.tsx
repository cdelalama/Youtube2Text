import { MediaConsole } from "./MediaConsole";

const screens = [
  "status",
  "capture",
  "library",
  "libraryDetail",
  "transcript",
  "activity",
  "cost",
  "errors",
  "sources",
  "automations",
  "apiOutput",
  "settings",
] as const;

type Screen = (typeof screens)[number];

function parseScreen(value?: string | string[]): Screen {
  const candidate = Array.isArray(value) ? value[0] : value;
  return screens.includes(candidate as Screen) ? (candidate as Screen) : "status";
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ screen?: string | string[] }>;
}) {
  const query = await searchParams;
  return <MediaConsole initialScreen={parseScreen(query?.screen)} />;
}
