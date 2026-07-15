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

export default async function LoginPage({ searchParams }: {
  searchParams?: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const query = await searchParams;
  const error = Array.isArray(query?.error) ? query?.error[0] : query?.error;
  return (
    <LoginForm
      nextPath={safeNextPath(query?.next)}
      configurationError={error === "not_configured"}
    />
  );
}
