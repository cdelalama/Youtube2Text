export async function waitFor(label, operation, timeoutMs = 120_000, retryMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(retryMs, Math.max(0, deadline - Date.now()))));
    }
  }
  throw new Error(`${label} did not become ready: ${lastError?.message ?? lastError}`);
}

export function requireLoginRedirect(location, webUrl) {
  if (!location) throw new Error("web root did not redirect to /login");
  const destination = new URL(location, webUrl);
  if (destination.origin !== new URL(webUrl).origin || destination.pathname !== "/login" ||
      destination.username || destination.password) {
    throw new Error("web root did not redirect to the canonical /login");
  }
}
