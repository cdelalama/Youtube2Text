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

export default function Page({ searchParams }: { searchParams?: { screen?: string | string[] } }) {
  return <MediaConsole initialScreen={parseScreen(searchParams?.screen)} />;
}
