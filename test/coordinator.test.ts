import { describe, it, expect } from 'vitest';
import { createAssetCoordinator } from '../src/coordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Each produce() call hands back the next queued deferred, so a test can settle
// runs in any order it likes and assert what the coordinator commits.
function queuedProducer<T>() {
  const runs: Array<ReturnType<typeof deferred<T>>> = [];
  let calls = 0;
  const produce = () => {
    calls++;
    const d = deferred<T>();
    runs.push(d);
    return d.promise;
  };
  return { produce, runs, calls: () => calls };
}

describe('createAssetCoordinator', () => {
  it('commits the result of a single run', async () => {
    const q = queuedProducer<string>();
    const coord = createAssetCoordinator(q.produce);
    const p = coord.ensure();
    expect(coord.get()).toBeUndefined();
    q.runs[0].resolve('assets');
    await p;
    expect(coord.get()).toBe('assets');
  });

  it('memoizes the in-flight run across concurrent ensure() calls', () => {
    const q = queuedProducer<string>();
    const coord = createAssetCoordinator(q.produce);
    const a = coord.ensure();
    const b = coord.ensure();
    expect(a).toBe(b);
    expect(q.calls()).toBe(1);
  });

  it('starts a fresh run after invalidate()', () => {
    const q = queuedProducer<string>();
    const coord = createAssetCoordinator(q.produce);
    coord.ensure();
    coord.invalidate();
    coord.ensure();
    expect(q.calls()).toBe(2);
  });

  it('does not let a superseded run overwrite the newest committed value', async () => {
    const q = queuedProducer<string>();
    const coord = createAssetCoordinator(q.produce);
    const stale = coord.ensure(); // run 0
    coord.invalidate();
    const fresh = coord.ensure(); // run 1

    q.runs[1].resolve('new');
    await fresh;
    expect(coord.get()).toBe('new');

    q.runs[0].resolve('old'); // resolves late, but is superseded
    await stale;
    expect(coord.get()).toBe('new');
  });

  it('swallows a superseded run failure so it cannot reject the current caller', async () => {
    const q = queuedProducer<string>();
    const coord = createAssetCoordinator(q.produce);
    const stale = coord.ensure(); // run 0
    coord.invalidate();
    const fresh = coord.ensure(); // run 1

    q.runs[1].resolve('new');
    await fresh;

    q.runs[0].reject(new Error('boom')); // superseded failure
    await expect(stale).resolves.toBeUndefined();
    expect(coord.get()).toBe('new');
  });

  it('supersedes the active run immediately on invalidate, before any new run', async () => {
    const q = queuedProducer<string>();
    const coord = createAssetCoordinator(q.produce);
    const p = coord.ensure(); // run 0
    coord.invalidate(); // supersede it now, without starting a replacement
    q.runs[0].resolve('stale');
    await expect(p).resolves.toBeUndefined();
    expect(coord.get()).toBeUndefined();
  });

  it('discards a superseded failure after invalidate without a new run', async () => {
    const q = queuedProducer<string>();
    const coord = createAssetCoordinator(q.produce);
    const p = coord.ensure(); // run 0
    coord.invalidate();
    q.runs[0].reject(new Error('boom'));
    await expect(p).resolves.toBeUndefined();
    expect(coord.get()).toBeUndefined();
  });

  it('propagates a failure from the current run', async () => {
    const q = queuedProducer<string>();
    const coord = createAssetCoordinator(q.produce);
    const p = coord.ensure();
    q.runs[0].reject(new Error('boom'));
    await expect(p).rejects.toThrow('boom');
    expect(coord.get()).toBeUndefined();
  });
});
