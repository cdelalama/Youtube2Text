"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";

type Provider = "assemblyai" | "deepgram" | "openai_whisper";
type Check = { state: "accepted" | "rejected" | "permission_unknown" | "unavailable"; checkedAt: string };
type Account = { id: string; provider: Provider; label: string; enabled: boolean; selected: boolean;
  currentCredentialId: string; keys: { id: string; hint: string; revoked: boolean; createdAt: string; access: Check | null }[] };
type Snapshot = { configured: boolean; activeProvider: Provider; selectedAccountId: string | null; selectionReady: boolean;
  accounts: Account[]; legacy: { provider: Provider; keys: string[]; selected: boolean }[]; check?: Check };
type Action = Record<string, string | boolean | number>;
const names: Record<Provider, string> = { assemblyai: "AssemblyAI", deepgram: "Deepgram", openai_whisper: "OpenAI Whisper" };
type Translate = (es: string, en: string) => string;

function checkText(check: Check | null | undefined, t: Translate): string {
  if (!check) return t("Sin comprobar", "Not checked");
  return ({ accepted: t("Acceso aceptado; saldo sin verificar", "Access accepted; credit not verified"),
    rejected: t("Clave rechazada", "Key rejected"), permission_unknown: t("Permisos insuficientes para comprobar", "Insufficient permission to check"),
    unavailable: t("Comprobación no disponible", "Check unavailable") })[check.state];
}

export default function ProviderAccounts({ lang, settingsRevision, onProviderSelected }: {
  lang: "es" | "en"; settingsRevision?: string; onProviderSelected: (provider: Provider) => void;
}) {
  const t: Translate = (es, en) => lang === "es" ? es : en;
  const prefix = useId();
  const [data, setData] = useState<Snapshot>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState<Provider>("deepgram");
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [reauth, setReauth] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [check, setCheck] = useState<Check>();
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/provider-accounts", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setData(await response.json());
    } catch { setError(lang === "es" ? "No se pudieron cargar las cuentas. Reintenta la consulta." : "Could not load accounts. Retry the request."); }
  }, [lang]);
  useEffect(() => { void load(); }, [load, settingsRevision]);

  function failure(code: string) {
    if (code === "recent_auth_required") {
      setReauth(true);
      return t("Confirma tu contraseña para gestionar claves durante cinco minutos. Después, repite la acción.", "Confirm your password to manage keys for five minutes. Then repeat the action.");
    }
    const messages: Record<string, string> = {
      duplicate_credential: t("Esta clave ya está guardada. Usa su cuenta existente.", "This key is already saved. Use its existing account."),
      account_not_ready: t("Activa la cuenta y elige una clave que no esté revocada.", "Enable the account and choose a key that is not revoked."),
      selected_account_unavailable: t("La cuenta seleccionada no está disponible. Elige otra antes de transcribir.", "The selected account is unavailable. Choose another before transcribing."),
      probe_rate_limited: t("Se han hecho varias comprobaciones. Espera un minuto.", "Several checks have been made. Wait one minute."),
      invalid_request: t("Revisa el nombre y la clave. No se guardaron los cambios.", "Check the name and key. Changes were not saved."),
      api_unreachable: t("Se perdió la conexión. Actualiza la lista antes de repetir el cambio.", "Connection lost. Refresh the list before repeating the change."),
    };
    return messages[code] ?? t("No se pudo completar la acción. Actualiza la lista y revisa el estado.", "Could not complete the action. Refresh the list and check its state.");
  }
  async function perform(action: Action, success?: string): Promise<boolean> {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/provider-accounts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) });
      const result = await response.json();
      if (!response.ok) { setError(failure(result.error)); return false; }
      setData(result);
      if (result.check) setMessage(checkText(result.check, t));
      else setMessage(success ?? t("Cambio guardado.", "Change saved."));
      if (action.action === "probe_unsaved") setCheck(result.check);
      if (action.action === "select") {
        const account = (result as Snapshot).accounts.find((item) => item.id === action.accountId)!;
        const settingsResponse = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ settings: { sttProvider: account.provider } }) });
        if (!settingsResponse.ok) {
          setError(t("La cuenta quedó elegida para su proveedor, pero no se pudo activar ese proveedor. Revisa Proveedor y guarda los cambios.",
            "The account was selected for its provider, but that provider could not be activated. Check Provider and save changes."));
          await load(); return false;
        }
        onProviderSelected(account.provider);
        await load();
      }
      return true;
    } catch { setError(failure("api_unreachable")); return false; }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await perform({ action: "create", provider, label, token }, t("Cuenta guardada. Puedes comprobarla o elegirla para nuevas transcripciones.", "Account saved. You can check it or select it for new transcriptions."))) {
      setToken(""); setLabel(""); setCheck(undefined); setAdding(false);
    }
  }
  async function unlock(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passphrase }) });
      setPassphrase("");
      if (!response.ok) {
        setError(response.status === 429 ? t("Demasiados intentos. Espera quince minutos.", "Too many attempts. Wait fifteen minutes.") : t("No se pudo confirmar la contraseña.", "Could not confirm the password.")); return;
      }
      setReauth(false); setMessage(t("Acceso confirmado durante cinco minutos. Ya puedes repetir la acción.", "Access confirmed for five minutes. You can repeat the action now."));
    } catch { setError(failure("api_unreachable")); }
    finally { setBusy(false); }
  }
  return <section className="m2t-panel m2t-accounts" aria-labelledby={`${prefix}-title`} aria-busy={busy}>
    <div className="m2t-panel-head"><h2 id={`${prefix}-title`}>{t("Cuentas de transcripción", "Transcription accounts")}</h2>
      <button className="m2t-button" disabled={busy || !data?.configured} onClick={() => { setAdding(true); setMessage(""); }}>{t("Añadir cuenta", "Add account")}</button></div>
    <p>{t("Añade tus cuentas de AssemblyAI, Deepgram u OpenAI. Varias claves de una misma cuenta comparten su crédito.", "Add your AssemblyAI, Deepgram or OpenAI accounts. Keys belonging to one account share its credit.")}</p>
    {error && <div className="m2t-account-error" role="alert">{error}</div>}
    <div className="m2t-account-feedback" role="status" aria-live="polite">{message}</div>
    {reauth && <form className="m2t-account-form" onSubmit={unlock}>
      <label htmlFor={`${prefix}-password`}>{t("Confirma tu contraseña de Media2Text", "Confirm your Media2Text password")}</label>
      <input id={`${prefix}-password`} type="password" autoComplete="current-password" maxLength={512} required value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
      <button className="m2t-button" disabled={busy}>{t("Confirmar acceso", "Confirm access")}</button>
    </form>}
    {!data ? <button disabled={busy} className="m2t-button ghost" onClick={() => void load()}>{t("Cargar cuentas", "Load accounts")}</button>
      : !data.configured ? <p>{t("La gestión de cuentas está pendiente de activar en el servidor. Las claves existentes siguen disponibles.", "Account management is awaiting server activation. Existing keys remain available.")}</p>
      : <>
        <p className={data.selectionReady ? "" : "m2t-account-error"}>
          {t("Nuevos trabajos", "New jobs")}: <strong>{names[data.activeProvider]} · {data.accounts.find((account) => account.id === data.selectedAccountId)?.label ?? t("configuración existente", "existing configuration")}</strong>
          {!data.selectionReady && <> — {t("elige una cuenta disponible antes de transcribir", "choose an available account before transcribing")}</>}
        </p>
        {adding && <form className="m2t-account-form" onSubmit={save}>
          <fieldset disabled={busy}><legend>{t("Añadir cuenta", "Add account")}</legend>
            <label htmlFor={`${prefix}-provider`}>{t("Proveedor", "Provider")}</label>
            <select id={`${prefix}-provider`} value={provider} onChange={(event) => { setProvider(event.target.value as Provider); setCheck(undefined); }}>
              {Object.entries(names).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
            <label htmlFor={`${prefix}-label`}>{t("Nombre para reconocer la cuenta", "Name to recognize the account")}</label>
            <input id={`${prefix}-label`} required maxLength={80} placeholder={t("Por ejemplo: Cuenta personal", "For example: Personal account")} value={label} onChange={(event) => setLabel(event.target.value)} />
            <label htmlFor={`${prefix}-token`}>{t("Clave API", "API key")}</label>
            <input id={`${prefix}-token`} type="password" required minLength={8} maxLength={4096} autoComplete="off" autoCapitalize="none" spellCheck={false} value={token} onChange={(event) => { setToken(event.target.value); setCheck(undefined); }} />
            <p>{t("Se guardará cifrada. El nombre es tu alias, no una identidad verificada por el proveedor.", "It will be encrypted. The name is your alias, not an identity verified by the provider.")}</p>
            {check && <p>{checkText(check, t)}</p>}
            <div className="m2t-account-actions">
              <button type="button" disabled={token.trim().length < 8} onClick={() => void perform({ action: "probe_unsaved", provider, token })}>{t("Comprobar acceso", "Check access")}</button>
              <button className="m2t-button" type="submit">{t("Guardar cuenta", "Save account")}</button>
              <button type="button" onClick={() => { setAdding(false); setToken(""); setCheck(undefined); }}>{t("Cancelar", "Cancel")}</button>
            </div>
            <p>{t("Puedes guardar sin comprobar. Guardar no selecciona la cuenta ni inicia una transcripción.", "You can save without checking. Saving does not select the account or start a transcription.")}</p>
          </fieldset>
        </form>}
        {data.accounts.length === 0 && !adding && <p>{t("Aún no has añadido cuentas. Empieza con «Añadir cuenta» o importa las claves existentes.", "No accounts added yet. Start with Add account or import existing keys.")}</p>}
        {data.accounts.map((account) => <AccountItem key={account.id} account={account} t={t} busy={busy}
          active={data.activeProvider === account.provider} perform={perform} />)}
      </>}
    {data && <details className="m2t-account-details"><summary>{t("Claves de la configuración existente", "Keys from existing configuration")}</summary>
      <p>{t("Son de solo lectura. Importar crea una cuenta sin cambiar la selección actual. No duplica el crédito disponible.", "These are read-only. Import creates an account without changing the current selection. It does not duplicate available credit.")}</p>
      {data.legacy.filter((legacy) => legacy.keys.length).map((legacy) => <div className="m2t-account-legacy" key={legacy.provider}>
        <strong>{names[legacy.provider]}</strong><span>{legacy.keys.join(" · ")}</span><span>{legacy.selected ? t("En uso para este proveedor", "In use for this provider") : t("Sustituida por una cuenta", "Replaced by an account")}</span>
        <div className="m2t-account-actions">
          {legacy.keys.map((hint, legacyIndex) => <button key={legacyIndex} disabled={busy || !data.configured} onClick={() => void perform({ action: "import_legacy", provider: legacy.provider, legacyIndex, label: `${names[legacy.provider]} · ${t("importada", "imported")}` }, t("Cuenta importada. Elígela cuando quieras usarla.", "Account imported. Select it when you want to use it."))}>{t("Importar clave", "Import key")} {hint}</button>)}
          {!legacy.selected && <button disabled={busy} onClick={() => void perform({ action: "use_legacy", provider: legacy.provider })}>{t("Volver a esta configuración", "Use this configuration again")}</button>}
        </div>
      </div>)}
    </details>}
    <p>{t("Saldo: desconocido. Comprobar acceso no confirma crédito ni permiso para transcribir. Los límites de gasto siguen vigentes.", "Balance: unknown. Checking access does not confirm credit or transcription permission. Spending limits still apply.")}</p>
  </section>;
}

function AccountItem({ account, t, busy, active, perform }: { account: Account; t: Translate; busy: boolean; active: boolean;
  perform: (action: Action, success?: string) => Promise<boolean> }) {
  const id = useId();
  const [label, setLabel] = useState(account.label);
  const [token, setToken] = useState("");
  const [revoking, setRevoking] = useState<string>();
  const current = account.keys.find((key) => key.id === account.currentCredentialId);
  return <article className="m2t-account-row">
    <div><h3>{account.label}</h3><p>{names[account.provider]} · {account.enabled ? t("Activa", "Enabled") : t("Desactivada", "Disabled")}
      {account.selected && <> · <strong>{active ? t("Elegida para nuevos trabajos", "Selected for new jobs") : t("Elegida para este proveedor", "Selected for this provider")}</strong></>}</p>
      <p>{current?.hint} · {current?.revoked ? t("Clave revocada localmente", "Key locally revoked") : checkText(current?.access, t)}</p>
    </div>
    <div className="m2t-account-actions">
      {(!account.selected || !active) && <button disabled={busy || !account.enabled || current?.revoked} onClick={() => void perform({ action: "select", accountId: account.id }, t("Cuenta elegida para nuevas transcripciones.", "Account selected for new transcriptions."))}>{t("Usar para nuevas transcripciones", "Use for new transcriptions")}</button>}
      <button disabled={busy || current?.revoked} onClick={() => void perform({ action: "probe", accountId: account.id })}>{t("Comprobar acceso", "Check access")}</button>
    </div>
    <details className="m2t-account-details"><summary>{t("Gestionar cuenta y claves", "Manage account and keys")}</summary>
      <fieldset disabled={busy}>
        <form className="m2t-account-form" onSubmit={(event) => { event.preventDefault(); void perform({ action: "rename", accountId: account.id, label }); }}>
          <label htmlFor={`${id}-label`}>{t("Nombre de la cuenta", "Account name")}</label>
          <input id={`${id}-label`} value={label} required maxLength={80} onChange={(event) => setLabel(event.target.value)} />
          <button>{t("Guardar nombre", "Save name")}</button>
        </form>
        <button onClick={() => void perform({ action: "enable", accountId: account.id, enabled: !account.enabled })}>{account.enabled ? t("Desactivar para nuevos trabajos", "Disable for new jobs") : t("Activar cuenta", "Enable account")}</button>
        <form className="m2t-account-form" onSubmit={async (event) => { event.preventDefault(); if (await perform({ action: "add_key", accountId: account.id, token }, t("Nueva clave guardada. Los trabajos ya aceptados conservan su clave anterior.", "New key saved. Accepted jobs keep their previous key."))) setToken(""); }}>
          <label htmlFor={`${id}-key`}>{t("Añadir o renovar clave", "Add or renew key")}</label>
          <input id={`${id}-key`} type="password" required minLength={8} maxLength={4096} autoComplete="off" autoCapitalize="none" spellCheck={false} value={token} onChange={(event) => setToken(event.target.value)} />
          <button>{t("Guardar nueva clave", "Save new key")}</button>
        </form>
        <ul className="m2t-account-keys">{account.keys.map((key) => <li key={key.id}>
          <span>{key.hint} · {new Date(key.createdAt).toLocaleDateString()} · {key.revoked ? t("Revocada localmente", "Locally revoked") : key.id === account.currentCredentialId ? t("Actual", "Current") : t("Anterior", "Previous")}</span>
          {key.access && <small>{checkText(key.access, t)} · {new Date(key.access.checkedAt).toLocaleString()}</small>}
          {!key.revoked && <div className="m2t-account-actions">
            {key.id !== account.currentCredentialId && <button onClick={() => void perform({ action: "use_key", accountId: account.id, credentialId: key.id })}>{t("Usar esta clave", "Use this key")}</button>}
            <button onClick={() => setRevoking(key.id)}>{t("Revocar localmente…", "Revoke locally…")}</button>
          </div>}
          {revoking === key.id && <div className="m2t-account-revoke">
            <p>{t("Esto bloquea la clave y solicita cancelar los trabajos que la usan. Una solicitud ya enviada puede seguir procesándose y generar cargos. Revoca también la clave en el proveedor si está comprometida.", "This blocks the key and requests cancellation of jobs using it. A submitted request may continue processing and incur charges. Revoke it at the provider too if compromised.")}</p>
            <div className="m2t-account-actions"><button onClick={async () => { if (await perform({ action: "revoke", accountId: account.id, credentialId: key.id }, t("Clave bloqueada localmente; se ha solicitado cancelar sus trabajos activos.", "Key blocked locally; cancellation requested for its active jobs."))) setRevoking(undefined); }}>{t("Confirmar revocación local", "Confirm local revocation")}</button>
              <button onClick={() => setRevoking(undefined)}>{t("Cancelar", "Cancel")}</button></div>
          </div>}
        </li>)}</ul>
      </fieldset>
    </details>
  </article>;
}
