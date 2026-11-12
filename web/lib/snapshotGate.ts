/**
 * Orders snapshot reads against changes made from the same screen.
 *
 * A read that began before a change started or finished may carry the state
 * from before that change, and it can arrive after the change's own answer. If
 * it were applied it would undo what the operator just did on screen (a switch
 * showing off right after it was turned on). Such reads are dropped; so is a
 * read that arrives after a newer read was already applied.
 */
export function createSnapshotGate() {
  let clock = 0;
  let staleBefore = 0;
  let applied = 0;
  return {
    /** Call when a read starts; give the token to accepts() when it returns. */
    beginRead(): number {
      clock += 1;
      return clock;
    },
    /** Call when a change starts and again when it has finished or failed. */
    changed(): void {
      clock += 1;
      staleBefore = clock;
    },
    /** True when the read may be shown. A true answer marks it as applied. */
    accepts(token: number): boolean {
      if (token <= staleBefore || token < applied) return false;
      applied = token;
      return true;
    },
  };
}
