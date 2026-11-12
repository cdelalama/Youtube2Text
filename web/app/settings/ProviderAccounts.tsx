"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";

type Provider = "assemblyai" | "deepgram" | "openai_whisper";
type Check = { state: "accepted" | "rejected" | "permission_unknown" | "unavailable"; checkedAt: string };
type Health = { state: "ok" | "rejected" | "exhausted"; since: string | null; status: number | null };
type Account = { id: string; provider: Provider; label: string; enabled: boolean; selected: boolean;
  currentCredentialId: string; keyOrder: string[];
  keys: { id: string; hint: string; revoked: boolean; createdAt: string; access: Check | null; health: Health }[] };
type Party = { accountId: string; label: string; provider: Provider; keyHint: string };
export type FailoverNotice = { id: string; kind: "moved" | "blocked" | "stopped"; reason: "rejected" | "exhausted"; status: number | null;
  from: Party; to: Party | null; serviceChanged: boolean; count: number; firstAt: string; lastAt: string };
type Failover = { enabled: boolean; order: string[]; effective: { provider: Provider; accountId: string; credentialId: string } | null;
  blocked: boolean; unhealthyKeys: number; notices: FailoverNotice[] };
type Snapshot = { configured: boolean; activeProvider: Provider; selectedAccountId: string | null; selectionReady: boolean;
  accounts: Account[]; failover: Failover; legacy: { provider: Provider; keys: string[]; selected: boolean }[]; check?: Check };
type Action = Record<string, string | boolean | number | string[]>;
const names: Record<Provider, string> = { assemblyai: "AssemblyAI", deepgram: "Deepgram", openai_whisper: "OpenAI Whisper" };
type Translate = (es: string, en: string) => string;
/** How often an open console re-reads accounts and notices. */
export const REFRESH_MS = 20_000;

/** Tolerates an API that predates automatic failover, so a mixed rollout cannot break the screen. */
function normalize(raw: Snapshot): Snapshot {
  return { ...raw,
    failover: raw.failover ?? { enabled: false, order: [], effective: null, blocked: false, unhealthyKeys: 0, notices: [] },
    accounts: (raw.accounts ?? []).map((account) => ({ ...account,
      keyOrder: account.keyOrder ?? account.keys.filter((key) => !key.revoked).map((key) => key.id),
      keys: account.keys.map((key) => ({ ...key, health: key.health ?? { state: "ok" as const, since: null, status: null } })) })) };
}

function reasonText(reason: "rejected" | "exhausted", status: number | null, t: Translate): string {
  const http = status ? ` (HTTP ${status})` : "";
  return reason === "exhausted"
    ? t(`el servicio respondió que no queda saldo o cuota${http}`, `the service answered that no credit or quota is left${http}`)
    : t(`el servicio rechazó la clave${http}`, `the service rejected the key${http}`);
}
function healthText(health: Health, t: Translate): string {
  const since = health.since ? new Date(health.since).toLocaleString() : "";
  const http = health.status ? ` (HTTP ${health.status})` : "";
  return health.state === "exhausted" ? t(`Sin saldo o cuota desde ${since}${http}`, `No credit or quota since ${since}${http}`)
    : health.state === "rejected" ? t(`Rechazada por el servicio desde ${since}${http}`, `Rejected by the service since ${since}${http}`) : "";
}
/** Plain-language account of one automatic change. Shared with the console banner. */
export function failoverNoticeText(notice: FailoverNotice, t: Translate): string {
  const why = reasonText(notice.reason, notice.status, t);
  const when = notice.count > 1
    ? t(` Ha ocurrido ${notice.count} veces; la última, el ${new Date(notice.lastAt).toLocaleString()}.`,
      ` It happened ${notice.count} times; most recently on ${new Date(notice.lastAt).toLocaleString()}.`)
    : t(` Ocurrió el ${new Date(notice.lastAt).toLocaleString()}.`, ` It happened on ${new Date(notice.lastAt).toLocaleString()}.`);
  const from = notice.from;
  const stopped = t(`La clave ${from.keyHint} de la cuenta «${from.label}» (${names[from.provider]}) ha dejado de usarse: ${why}.`,
    `Key ${from.keyHint} of account "${from.label}" (${names[from.provider]}) is no longer used: ${why}.`);
  if (!notice.to) {
    return stopped + t(" No queda ninguna otra clave o cuenta disponible en tu lista: los trabajos fallan hasta que recargues saldo, añadas una clave o marques una como disponible.",
      " No other key or account in your list is available: jobs fail until you add credit, add a key or mark one as available.") + when;
  }
  const to = notice.to;
  if (notice.kind === "stopped") {
    // Nothing took over for that recording: say that it stopped, and why.
    return stopped + t(` Una grabación que ya estaba transcrita en parte se ha detenido y no se ha completado: la siguiente cuenta de tu lista, «${to.label}», es de otro servicio (${names[to.provider]}), y no se mezclan dos servicios en una misma transcripción ni se paga dos veces. Vuelve a lanzar esa grabación para transcribirla entera con ${names[to.provider]}.`,
      ` A recording that was already partly transcribed has stopped and was not completed: the next account in your list, "${to.label}", belongs to another service (${names[to.provider]}), and two services are never mixed in one transcript nor paid twice. Run that recording again to transcribe it entirely with ${names[to.provider]}.`) + when;
  }
  const takeover = to.accountId === from.accountId
    ? t(` Ahora se usa la clave ${to.keyHint} de la misma cuenta.`, ` Key ${to.keyHint} of the same account is used now.`)
    : t(` Ahora se usa la cuenta «${to.label}» (${names[to.provider]}), clave ${to.keyHint}.`,
      ` Account "${to.label}" (${names[to.provider]}), key ${to.keyHint}, is used now.`);
  const service = notice.serviceChanged
    ? t(` Ha cambiado el servicio de transcripción: de ${names[from.provider]} a ${names[to.provider]}. La calidad de las transcripciones puede ser distinta.`,
      ` The transcription service changed: from ${names[from.provider]} to ${names[to.provider]}. Transcription quality may differ.`)
    : "";
  return stopped + takeover + service + when;
}

function checkText(check: Check | null | undefined, t: Translate): string {
  if (!check) return t("Sin comprobar", "Not checked");
  return ({ accepted: t("Acceso aceptado; saldo sin verificar", "Access accepted; credit not verified"),
    rejected: t("Clave rechazada", "Key rejected"), permission_unknown: t("Permisos insuficientes para comprobar", "Insufficient permission to check"),
    unavailable: t("Comprobación no disponible", "Check unavailable") })[check.state];
}

export default function ProviderAccounts({ lang, settingsRevision, onProviderSelected, onNoticesChanged }: {
  lang: "es" | "en"; settingsRevision?: string; onProviderSelected: (provider: Provider) => void;
  onNoticesChanged?: (notices: FailoverNotice[]) => void;
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
      setData(normalize(await response.json()));
    } catch { setError(lang === "es" ? "No se pudieron cargar las cuentas. Reintenta la consulta." : "Could not load accounts. Retry the request."); }
  }, [lang]);
  useEffect(() => { void load(); }, [load, settingsRevision]);
  // Jobs and admissions change key state and notices without any action here,
  // so the open screen is refreshed periodically (never over a pending action).
  const busyRef = useRef(false);
  busyRef.current = busy;
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!busyRef.current && document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => { if (data) onNoticesChanged?.(data.failover.notices); }, [data, onNoticesChanged]);

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
      no_healthy_account_available: t("No queda ninguna clave o cuenta disponible. Recarga saldo, añade una clave o marca una como disponible.", "No key or account is available. Add credit, add a key or mark one as available."),
      notice_not_found: t("Ese aviso ya estaba descartado.", "That notice was already dismissed."),
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
      setData(normalize(result));
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
        {data.failover.notices.map((notice) => <div className="m2t-account-notice" role="alert" key={notice.id}>
          <strong>{notice.kind === "stopped" ? t("Grabación detenida", "Recording stopped") : notice.to ? t("Cambio automático de cuenta", "Automatic account change") : t("Sin cuentas disponibles", "No accounts available")}</strong>
          <p>{failoverNoticeText(notice, t)}</p>
          <button disabled={busy} onClick={() => void perform({ action: "dismiss_notice", noticeId: notice.id }, t("Aviso descartado.", "Notice dismissed."))}>{t("Descartar aviso", "Dismiss notice")}</button>
        </div>)}
        <p className={data.selectionReady && !data.failover.blocked ? "" : "m2t-account-error"}>
          {t("Nuevos trabajos", "New jobs")}: <strong>{names[data.activeProvider]} · {data.accounts.find((account) => account.id === data.selectedAccountId)?.label ?? t("configuración existente", "existing configuration")}</strong>
          {!data.selectionReady && <> — {t("elige una cuenta disponible antes de transcribir", "choose an available account before transcribing")}</>}
          {data.failover.blocked && <> — {t("su clave está marcada como no disponible y no queda otra en tu lista", "its key is marked unavailable and nothing else in your list can take over")}</>}
          {(() => {
            const selected = data.accounts.find((account) => account.id === data.selectedAccountId);
            const effective = data.failover.effective;
            if (!data.failover.enabled || !selected || !effective || effective.credentialId === selected.currentCredentialId) return null;
            const account = data.accounts.find((item) => item.id === effective.accountId);
            const hint = account?.keys.find((key) => key.id === effective.credentialId)?.hint ?? "";
            return <> — {t("por el cambio automático ahora se usa", "automatic change currently uses")} <strong>{names[effective.provider]} · {account?.label} · {hint}</strong></>;
          })()}
        </p>
        <FailoverPanel data={data} t={t} busy={busy} perform={perform} />
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
          active={data.activeProvider === account.provider} failoverEnabled={data.failover.enabled} perform={perform} />)}
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

function move<T>(items: T[], index: number, delta: number): T[] {
  const next = [...items];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** One switch plus the ordered list of accounts allowed to take over (D-029). */
function FailoverPanel({ data, t, busy, perform }: { data: Snapshot; t: Translate; busy: boolean;
  perform: (action: Action, success?: string) => Promise<boolean> }) {
  const id = useId();
  const { enabled, order } = data.failover;
  const listed = order.map((accountId) => data.accounts.find((account) => account.id === accountId)).filter((account): account is Account => Boolean(account));
  const unlisted = data.accounts.filter((account) => !order.includes(account.id));
  const setOrder = (accountIds: string[]) => void perform({ action: "set_failover_order", accountIds }, t("Orden guardado.", "Order saved."));
  return <div className="m2t-account-failover">
    <h3>{t("Cambio automático de clave o cuenta", "Automatic key or account change")}</h3>
    <label className="m2t-account-switch" htmlFor={`${id}-switch`}>
      <input id={`${id}-switch`} type="checkbox" checked={enabled} disabled={busy}
        onChange={(event) => void perform({ action: "set_failover", enabled: event.target.checked },
          event.target.checked ? t("Cambio automático activado.", "Automatic change turned on.") : t("Cambio automático desactivado.", "Automatic change turned off."))} />
      <span>{t("Usar automáticamente la siguiente clave o cuenta", "Use the next key or account automatically")}</span>
    </label>
    <p>{t("Solo se cambia cuando el servicio rechaza la clave o responde que no queda saldo o cuota antes de aceptar el audio. Con un fallo de red, una espera agotada o un error del servicio, el trabajo falla como hasta ahora, para no pagar dos veces.",
      "A change happens only when the service rejects the key or answers that no credit or quota is left before accepting the audio. On a network failure, a timeout or a service error the job fails as before, to avoid paying twice.")}</p>
    <p>{t("Primero se prueba otra clave de la misma cuenta. Después, las cuentas de esta lista, de arriba abajo. Cada cambio te lo avisa la aplicación, también si ya descartaste un aviso anterior igual; si cambia el servicio, la calidad puede ser distinta. Los límites de gasto siguen vigentes.",
      "Another key of the same account is tried first. Then the accounts in this list, top to bottom. The application tells you about every change, even if you dismissed an identical earlier notice; if the service changes, quality may differ. Spending limits still apply.")}</p>
    {data.failover.unhealthyKeys > 0 && <p className="m2t-account-error">{enabled
      ? t(`Hay ${data.failover.unhealthyKeys} clave(s) marcadas como rechazadas o sin saldo: no se usan para trabajos nuevos hasta que las marques como disponibles. Una transcripción completada no borra esa marca.`,
        `${data.failover.unhealthyKeys} key(s) are marked rejected or out of credit: they are not used for new jobs until you mark them as available. A completed transcription does not clear that mark.`)
      : t(`Hay ${data.failover.unhealthyKeys} clave(s) marcadas como rechazadas o sin saldo. Con el interruptor desactivado se siguen usando; si lo activas, dejarán de usarse para trabajos nuevos hasta que las marques como disponibles.`,
        `${data.failover.unhealthyKeys} key(s) are marked rejected or out of credit. With the switch off they are still used; if you turn it on they stop being used for new jobs until you mark them as available.`)}</p>}
    {enabled && !data.selectedAccountId && <p className="m2t-account-error">{t("Ahora se usa la configuración existente, que no participa en el cambio automático. Elige una cuenta guardada aquí para que funcione.",
      "The existing configuration is in use and does not take part in automatic change. Select an account saved here for it to work.")}</p>}
    {listed.length === 0 ? <p>{t("La lista está vacía: solo se probarían otras claves de la cuenta elegida.", "The list is empty: only other keys of the selected account would be tried.")}</p>
      : <ol className="m2t-account-order">{listed.map((account, index) => <li key={account.id}>
        <span>{account.label} · {names[account.provider]}{account.enabled ? "" : ` · ${t("desactivada, se omite", "disabled, skipped")}`}</span>
        <div className="m2t-account-actions">
          <button disabled={busy || index === 0} onClick={() => setOrder(move(order, index, -1))}>{t("Subir", "Move up")}</button>
          <button disabled={busy || index === listed.length - 1} onClick={() => setOrder(move(order, index, 1))}>{t("Bajar", "Move down")}</button>
          <button disabled={busy} onClick={() => setOrder(order.filter((item) => item !== account.id))}>{t("Quitar de la lista", "Remove from list")}</button>
        </div>
      </li>)}</ol>}
    {unlisted.length > 0 && <div className="m2t-account-actions">{unlisted.map((account) =>
      <button key={account.id} disabled={busy} onClick={() => setOrder([...order, account.id])}>{t("Añadir a la lista", "Add to list")}: {account.label} · {names[account.provider]}</button>)}</div>}
  </div>;
}

function AccountItem({ account, t, busy, active, failoverEnabled, perform }: { account: Account; t: Translate; busy: boolean; active: boolean;
  failoverEnabled: boolean; perform: (action: Action, success?: string) => Promise<boolean> }) {
  const id = useId();
  const [label, setLabel] = useState(account.label);
  const [token, setToken] = useState("");
  const [revoking, setRevoking] = useState<string>();
  const current = account.keys.find((key) => key.id === account.currentCredentialId);
  return <article className="m2t-account-row">
    <div><h3>{account.label}</h3><p>{names[account.provider]} · {account.enabled ? t("Activa", "Enabled") : t("Desactivada", "Disabled")}
      {account.selected && <> · <strong>{active ? t("Elegida para nuevos trabajos", "Selected for new jobs") : t("Elegida para este proveedor", "Selected for this provider")}</strong></>}</p>
      <p>{current?.hint} · {current?.revoked ? t("Clave revocada localmente", "Key locally revoked") : checkText(current?.access, t)}</p>
      {current && current.health.state !== "ok" && <p className="m2t-account-error">{healthText(current.health, t)}</p>}
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
          {!key.revoked && account.keyOrder.length > 1 && <small>{t("Orden de uso automático", "Automatic use order")}: {account.keyOrder.indexOf(key.id) + 1} {t("de", "of")} {account.keyOrder.length}</small>}
          {key.health.state !== "ok" && <small className="m2t-account-error">{healthText(key.health, t)}. {failoverEnabled
            ? t("No se usa para trabajos nuevos hasta que la marques como disponible.", "Not used for new jobs until you mark it as available.")
            : t("El cambio automático está desactivado: se sigue usando.", "Automatic change is off: it is still used.")} {key.health.state === "exhausted"
            ? t("Comprobar acceso no confirma saldo: cuando hayas recargado, pulsa «Marcar como disponible».", "Checking access does not confirm credit: once you have topped up, press Mark as available.")
            : t("Puedes volver a comprobar el acceso o marcarla como disponible.", "You can check access again or mark it as available.")}</small>}
          {!key.revoked && <div className="m2t-account-actions">
            {key.health.state !== "ok" && <button onClick={() => void perform({ action: "reset_key_health", accountId: account.id, credentialId: key.id }, t("Clave marcada como disponible.", "Key marked as available."))}>{t("Marcar como disponible", "Mark as available")}</button>}
            {account.keyOrder.indexOf(key.id) > 1 && <button onClick={() => void perform({ action: "set_key_order", accountId: account.id, credentialIds: move(account.keyOrder, account.keyOrder.indexOf(key.id), -1) }, t("Orden guardado.", "Order saved."))}>{t("Subir en el orden", "Move up in order")}</button>}
            {account.keyOrder.indexOf(key.id) > 0 && account.keyOrder.indexOf(key.id) < account.keyOrder.length - 1 && <button onClick={() => void perform({ action: "set_key_order", accountId: account.id, credentialIds: move(account.keyOrder, account.keyOrder.indexOf(key.id), 1) }, t("Orden guardado.", "Order saved."))}>{t("Bajar en el orden", "Move down in order")}</button>}
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
