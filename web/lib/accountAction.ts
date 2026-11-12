// One operator action on the accounts screen, from start to finish.
//
// Selecting an account is two requests: the account is selected for its
// provider, then that provider is made the active one in settings. Other parts
// of the console (the banner) must be told only after BOTH have been attempted
// and the real resulting state has been read back; telling them after the first
// request let them read the old provider and stay stale.
//
// A change whose answer is lost is a third case. The request can fail after the
// server stored the change: the connection drops, the web server gives up
// waiting, or the answer cannot be read. The change is then NEVER sent again
// (it could be applied twice, or undo a later one); the stored state is read
// back, shown, and the rest of the console is told.

export type AccountActionDeps<Snapshot> = {
  /** POST the action to the accounts route. `status` is the HTTP status. */
  post(): Promise<{ ok: boolean; status?: number; body: Snapshot & { error?: string } }>;
  /** For `select` only: make the account's provider the active one. */
  activateProvider?(snapshot: Snapshot): Promise<boolean>;
  /** Read the accounts snapshot again and show it. False when it could not be read. */
  reload(): Promise<boolean>;
  /** Tell the rest of the console that the operation is over. */
  notifyChanged(): void;
};

export type AccountActionResult<Snapshot> =
  | { outcome: "done"; snapshot: Snapshot }
  /** The account was selected but its provider could not be made active. */
  | { outcome: "provider_not_activated"; snapshot: Snapshot }
  /** The API answered that it did not make the change. */
  | { outcome: "refused"; error: string }
  /** The answer was lost; the stored state was read back and is on screen. */
  | { outcome: "uncertain" }
  /** The answer was lost and the stored state could not be read back either. */
  | { outcome: "unreachable" };

export async function runAccountAction<Snapshot>(deps: AccountActionDeps<Snapshot>): Promise<AccountActionResult<Snapshot>> {
  let answer: Awaited<ReturnType<typeof deps.post>>;
  try {
    answer = await deps.post();
  } catch {
    // No answer, or one that could not be read: the change may be stored.
    return await readBackUncertainChange(deps);
  }
  if (!answer.ok) {
    // A 5xx is a failure of the web server or the API, possibly after the
    // change was stored. Only a 4xx is the API saying it changed nothing.
    if ((answer.status ?? 0) >= 500) return await readBackUncertainChange(deps);
    return { outcome: "refused", error: answer.body.error ?? "" };
  }
  try {
    if (!deps.activateProvider) return { outcome: "done", snapshot: answer.body };
    const activated = await deps.activateProvider(answer.body);
    // Whatever happened to the second request, show what is really stored now.
    await deps.reload();
    return { outcome: activated ? "done" : "provider_not_activated", snapshot: answer.body };
  } catch {
    // The connection failed part-way: the state is unknown, so read it back.
    await deps.reload().catch(() => false);
    return { outcome: "unreachable" };
  } finally {
    // Once, and only after the whole operation, also when it failed part-way.
    deps.notifyChanged();
  }
}

async function readBackUncertainChange<Snapshot>(deps: AccountActionDeps<Snapshot>): Promise<AccountActionResult<Snapshot>> {
  try {
    const shown = await deps.reload().catch(() => false);
    return { outcome: shown ? "uncertain" : "unreachable" };
  } finally {
    // The banner reads its own state again whether or not the change landed.
    deps.notifyChanged();
  }
}
