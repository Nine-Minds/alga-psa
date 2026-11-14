import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { lockQboItemTargets } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../actions/_dbTestUtils';

/**
 * alga-2026-0002899: the tenant/realm/item advisory lock that serialises QBO
 * item import with mapping create/edit/relink/unlink, tested against real
 * Postgres sessions (a mock cannot prove blocking).
 */

let db: Knex;

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
});

afterAll(async () => {
  await db?.destroy().catch(() => undefined);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('lockQboItemTargets (real Postgres)', () => {
  it('a second transaction on the same tenant/realm/item waits for the first to finish', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstHolds = new Promise<void>((r) => (releaseFirst = r));
    let firstLocked!: () => void;
    const firstReady = new Promise<void>((r) => (firstLocked = r));

    const first = db.transaction(async (trx) => {
      await lockQboItemTargets(trx, 't-lock', [{ realm: 'r1', itemId: 'item-1' }]);
      order.push('first-locked');
      firstLocked();
      await firstHolds;
      order.push('first-done');
    });
    await firstReady;

    const second = db.transaction(async (trx) => {
      await lockQboItemTargets(trx, 't-lock', [{ realm: 'r1', itemId: 'item-1' }]);
      order.push('second-locked');
    });

    await sleep(300);
    expect(order).toEqual(['first-locked']); // second is blocked
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-locked', 'first-done', 'second-locked']);
  });

  it('does not block a different item, realm or tenant', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let ready!: () => void;
    const held = new Promise<void>((r) => (ready = r));
    const first = db.transaction(async (trx) => {
      await lockQboItemTargets(trx, 't-lock', [{ realm: 'r1', itemId: 'item-1' }]);
      ready();
      await hold;
    });
    await held;

    for (const target of [
      ['t-lock', 'r1', 'item-2'],
      ['t-lock', 'r2', 'item-1'],
      ['t-other', 'r1', 'item-1'],
    ]) {
      await db.transaction(async (trx) => {
        await lockQboItemTargets(trx, target[0], [{ realm: target[1], itemId: target[2] }]);
      });
    }
    release();
    await first;
  });

  it('locks several targets in sorted order so opposite-order callers cannot deadlock', async () => {
    const a = { realm: 'r1', itemId: 'item-a' };
    const b = { realm: 'r1', itemId: 'item-b' };
    const runs = Array.from({ length: 8 }, (_, i) =>
      db.transaction(async (trx) => {
        await lockQboItemTargets(trx, 't-lock', i % 2 ? [a, b] : [b, a, b]);
        await sleep(10);
      })
    );
    await expect(Promise.all(runs)).resolves.toBeDefined();
  });
});
