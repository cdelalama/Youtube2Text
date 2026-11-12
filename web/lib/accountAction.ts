// One operator action on the accounts screen, from start to finish.
//
// Selecting an account is two requests: the account is selected for its
// provider, then that provider is made the active one in settings. Other parts
// of the console (the banner) must be told only after BOTH have been attempted
// and the real resulting state has been read back; telling them after the first
// request let them read the old provider and stay stale.

export type AccountActionDeps<Snapshot> = {
  /** POST the action to the accounts route. */
  post(): Promise<{ ok: boolean; body: Snapshot & { error?: string } }>;
  /** For `select` only: make the account's provider the active one. */
  activateProvider?(snapshot: Snapshot): Promise<boolean>;
  /** Read the accounts snapshot again and show it. */
  reload(): Promise<void>;
  /** Tell the rest of the console that the operation is over. */
  notifyChanged(): void;
};

export type AccountActionResult<Snapshot> =
  | { outcome: "done"; snapshot: Snapshot }
  /** The account was selected but its provider could not be made active. */
  | { outcome: "provider_not_activated"; snapshot: Snapshot }
  | { outcome: "refused"; error: string }
  | { outcome: "unreachable" };

export async function runAccountAction<Snapshot>(deps: AccountActionDeps<Snapshot>): Promise<AccountActionResult<Snapshot>> {
  let changed = false;
  try {
    const answer = await deps.post();
    if (!answer.ok) return { outcome: "refused", error: answer.body.error ?? "" };
    changed = true;
    if (!deps.activateProvider) return { outcome: "done", snapshot: answer.body };
    const activated = await deps.activateProvider(answer.body);
    // Whatever happened to the second request, show what is really stored now.
    await deps.reload();
    return { outcome: activated ? "done" : "provider_not_activated", snapshot: answer.body };
  } catch {
    // The connection failed part-way: the state is unknown, so read it back.
    if (changed) await deps.reload().catch(() => undefined);
    return { outcome: "unreachable" };
  } finally {
    // Once, and only after the whole operation, also when it failed part-way.
    if (changed) deps.notifyChanged();
  }
}
