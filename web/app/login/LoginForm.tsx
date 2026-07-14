"use client";

import { FormEvent, useState } from "react";

export function LoginForm({ nextPath, configurationError }: {
  nextPath: string;
  configurationError: boolean;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState(configurationError ? "Autenticación no configurada" : "");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (response.ok) {
        window.location.assign(nextPath);
        return;
      }
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (body.error === "too_many_attempts") setError("Demasiados intentos. Espera 15 minutos.");
      else if (body.error === "web_auth_not_configured") setError("Autenticación no configurada");
      else setError("Credenciales incorrectas");
    } catch {
      setError("No se pudo contactar con el servicio");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="m2t-auth-shell">
      <section className="m2t-auth-panel" aria-labelledby="login-title">
        <div className="m2t-auth-brand">
          <div className="m2t-logo" aria-hidden="true"><span /><span /><span /></div>
          <div>
            <strong>Media2Text</strong>
            <small>OPERATOR CONSOLE</small>
          </div>
        </div>
        <form onSubmit={submit}>
          <h1 id="login-title">Acceso de operador</h1>
          <label htmlFor="passphrase">Contraseña</label>
          <input
            id="passphrase"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          {error ? <p className="m2t-auth-error" role="alert">{error}</p> : null}
          <button type="submit" disabled={busy || configurationError}>
            {busy ? "Verificando..." : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
