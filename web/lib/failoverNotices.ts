// Wording of automatic account changes, shared by the settings screen and the
// banner. A notice is a past event, so it is told in the past tense; where new
// work goes right now is a separate sentence built from current routing.

export type Provider = "assemblyai" | "deepgram" | "openai_whisper";
export type Translate = (es: string, en: string) => string;
export const providerNames: Record<Provider, string> = {
  assemblyai: "AssemblyAI",
  deepgram: "Deepgram",
  openai_whisper: "OpenAI Whisper",
};

export type FailoverParty = { accountId: string; label: string; provider: Provider; keyHint: string };
export type FailoverNotice = {
  id: string;
  kind: "moved" | "blocked" | "stopped";
  reason: "rejected" | "exhausted";
  status: number | null;
  from: FailoverParty;
  to: FailoverParty | null;
  serviceChanged: boolean;
  count: number;
  firstAt: string;
  lastAt: string;
};
/** Where new work goes at this moment. Carries no key hint. */
export type FailoverRouting = { enabled: boolean; blocked: boolean; provider: Provider; accountLabel: string | null };

export function failoverNoticeTitle(notice: FailoverNotice, t: Translate): string {
  return notice.kind === "stopped" ? t("Grabación detenida", "Recording stopped")
    : notice.kind === "blocked" ? t("Trabajo detenido: no quedaban cuentas", "Job stopped: no accounts were left")
      : t("Cambio automático de cuenta", "Automatic account change");
}

/** What happened, in the past tense. Says nothing about what is in use now. */
export function failoverNoticeText(notice: FailoverNotice, t: Translate): string {
  const { from, to } = notice;
  const http = notice.status ? ` (HTTP ${notice.status})` : "";
  const many = notice.count > 1;
  const why = notice.reason === "exhausted"
    ? t(`respondió que no quedaba saldo o cuota${http}`, `answered that no credit or quota was left${http}`)
    : t(`no aceptó la clave o su permiso${http}`, `did not accept the key or its permission${http}`);
  const refused = t(
    `${providerNames[from.provider]} rechazó ${many ? "peticiones" : "una petición"} con la clave ${from.keyHint} de la cuenta «${from.label}»: ${why}.`,
    `${providerNames[from.provider]} refused ${many ? "requests" : "a request"} with key ${from.keyHint} of account "${from.label}": it ${why}.`
  );
  const when = many
    ? t(` Ocurrió ${notice.count} veces; la última, el ${new Date(notice.lastAt).toLocaleString()}.`,
      ` It happened ${notice.count} times; most recently on ${new Date(notice.lastAt).toLocaleString()}.`)
    : t(` Ocurrió el ${new Date(notice.lastAt).toLocaleString()}.`, ` It happened on ${new Date(notice.lastAt).toLocaleString()}.`);

  if (notice.kind === "stopped" && to) {
    return refused + t(
      ` Una grabación que ya estaba transcrita en parte se detuvo sin completarse: la siguiente cuenta de tu lista, «${to.label}», era de otro servicio (${providerNames[to.provider]}) y no se mezclan dos servicios en una misma transcripción. Ninguna cuenta continuó esa grabación. Si la transcribes de nuevo, se repetirán también las partes que ya estaban hechas, y esas partes se te pueden cobrar otra vez.`,
      ` A recording that was already partly transcribed stopped without being completed: the next account in your list, "${to.label}", belonged to another service (${providerNames[to.provider]}) and two services are never mixed in one transcript. No account continued that recording. If you transcribe it again, the parts that were already done are repeated too, and those parts can be charged again.`
    ) + when;
  }
  if (!to) {
    return refused + t(
      many ? " No quedaba ninguna otra clave o cuenta disponible en tu lista y esos trabajos fallaron."
        : " No quedaba ninguna otra clave o cuenta disponible en tu lista y el trabajo falló.",
      many ? " No other key or account in your list was available and those jobs failed."
        : " No other key or account in your list was available and the job failed."
    ) + when;
  }
  const subject = many ? t("Los trabajos afectados continuaron", "The affected jobs continued")
    : t("El trabajo afectado continuó", "The affected job continued");
  const takeover = to.accountId === from.accountId
    ? t(` ${subject} con la clave ${to.keyHint} de la misma cuenta.`, ` ${subject} with key ${to.keyHint} of the same account.`)
    : t(` ${subject} con la cuenta «${to.label}» (${providerNames[to.provider]}), clave ${to.keyHint}.`,
      ` ${subject} with account "${to.label}" (${providerNames[to.provider]}), key ${to.keyHint}.`);
  const service = notice.serviceChanged
    ? t(` El servicio de transcripción cambió de ${providerNames[from.provider]} a ${providerNames[to.provider]}: la calidad de esas transcripciones puede ser distinta.`,
      ` The transcription service changed from ${providerNames[from.provider]} to ${providerNames[to.provider]}: the quality of those transcriptions may differ.`)
    : "";
  return refused + takeover + service + when;
}

/** Where new work goes right now, in the present tense. */
export function failoverRoutingText(routing: FailoverRouting, t: Translate): string {
  const service = providerNames[routing.provider];
  if (routing.blocked) {
    return t("Ahora mismo no queda ninguna clave o cuenta disponible para los trabajos nuevos.",
      "Right now no key or account is available for new jobs.");
  }
  const where = routing.accountLabel
    ? t(`Ahora mismo los trabajos nuevos van a la cuenta «${routing.accountLabel}» (${service}).`,
      `Right now new jobs go to account "${routing.accountLabel}" (${service}).`)
    : t(`Ahora mismo los trabajos nuevos usan la configuración existente de ${service}.`,
      `Right now new jobs use the existing ${service} configuration.`);
  return routing.enabled ? where
    : `${where} ${t("El cambio automático está desactivado.", "Automatic change is off.")}`;
}
