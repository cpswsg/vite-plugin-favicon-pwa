// Coordinates asset (re)generation so only the newest run is ever observable.
//
// Each run is stamped with a monotonic token. A run commits its result only if
// it is still the latest when it settles, so a slow superseded run can neither
// overwrite the committed value nor reject a caller awaiting a newer run. This
// is what keeps a dev source-change from restoring stale assets: on change the
// caller drops the memoized run via `invalidate()`, and the in-flight run, once
// superseded, quietly discards its result.
//
// - `ensure()` memoizes the in-flight run, starting one if none is active.
// - `invalidate()` drops the memo so the next `ensure()` starts a fresh run.
// - `get()` returns the last committed result (undefined until the first run
//   commits).
export interface AssetCoordinator<T> {
  ensure(): Promise<void>;
  invalidate(): void;
  get(): T | undefined;
}

export function createAssetCoordinator<T>(produce: () => Promise<T>): AssetCoordinator<T> {
  let committed: T | undefined;
  let generation = 0;
  let pending: Promise<void> | undefined;

  const run = (): Promise<void> => {
    const token = ++generation;
    return produce().then(
      (result) => {
        if (token === generation) committed = result;
      },
      (err) => {
        // Only the latest run may surface a failure; a superseded run's error is
        // swallowed so it cannot reject a caller awaiting the current run.
        if (token === generation) throw err;
      },
    );
  };

  return {
    ensure: () => (pending ??= run()),
    invalidate: () => {
      // Bump the token so the active run is superseded immediately: a run still
      // in flight can no longer commit its (now stale) result or surface its
      // error, even before the next ensure() starts.
      generation++;
      pending = undefined;
    },
    get: () => committed,
  };
}
