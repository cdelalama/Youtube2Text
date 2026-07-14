import { LoginForm } from "./LoginForm";

function safeNextPath(value?: string | string[]): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith("/") || candidate.includes("\\")) return "/";
  try {
    const base = new URL("https://media2text.invalid");
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export default function LoginPage({ searchParams }: {
  searchParams?: { next?: string | string[]; error?: string | string[] };
}) {
  const error = Array.isArray(searchParams?.error) ? searchParams?.error[0] : searchParams?.error;
  return (
    <LoginForm
      nextPath={safeNextPath(searchParams?.next)}
      configurationError={error === "not_configured"}
    />
  );
}
