/**
 * Node 26 (26.2.x) added Temporal `*Instant` getters to `fs.Stats.prototype`
 * (atimeInstant / mtimeInstant / ctimeInstant / birthtimeInstant). On the bare
 * prototype the backing fields are NaN, so *reading* one of these getters throws
 * `RangeError: The number NaN cannot be converted to a BigInt`. Any library that
 * enumerates the Stats prototype and reads property values then crashes at module
 * load — notably bluebird's `promisifyAll(require('fs'))`, pulled in transitively
 * via `node-vault -> postman-request -> stream-length`, which 500'd every auth/DB
 * SSR route on the appliance when the base image floated to Node 26.2.0.
 *
 * This neutralises only the failure mode: each getter is wrapped so that if the
 * underlying read throws (prototype / NaN), it returns `undefined` instead of
 * throwing. Real Stats objects (valid backing data) still return their real
 * `Temporal.Instant`. It is idempotent and a no-op on Node versions that don't
 * define these getters.
 *
 * Imported (as a side effect) at the top of VaultSecretProvider.ts so it runs
 * before `node-vault` — the only module that drags in the offending chain.
 */
import fs from 'node:fs';

const PATCHED = Symbol.for('alga.node26FsStatsInstantGuard');

// The Node 26 getters whose BigInt conversion throws when read on the prototype.
const THROWING_INSTANT_GETTERS = [
  'atimeInstant',
  'mtimeInstant',
  'ctimeInstant',
  'birthtimeInstant',
] as const;

export function neutralizeNode26FsStatsBigIntGetters(): void {
  const proto = (fs.Stats?.prototype as unknown) as Record<PropertyKey, unknown> | undefined;
  if (!proto || proto[PATCHED]) {
    return;
  }

  for (const name of THROWING_INSTANT_GETTERS) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor || typeof descriptor.get !== 'function') {
      continue;
    }
    const originalGet = descriptor.get;
    Object.defineProperty(proto, name, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get(this: unknown) {
        try {
          return originalGet.call(this);
        } catch {
          return undefined;
        }
      },
    });
  }

  Object.defineProperty(proto, PATCHED, { value: true, enumerable: false, configurable: true });
}

// Apply on import so a bare `import './fixNode26FsStats'` is sufficient.
neutralizeNode26FsStatsBigIntGetters();
