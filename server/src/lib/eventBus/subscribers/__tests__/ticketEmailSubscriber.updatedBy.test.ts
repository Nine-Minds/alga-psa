import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { ticketEmailSubscriberTestHarness } from '../ticketEmailSubscriber';

const { formatAccumulatedChanges, resolveUpdatedByDisplay } = ticketEmailSubscriberTestHarness;

const tenant = randomUUID();
const ghostId = randomUUID();
const realId = randomUUID();

// users table stub: only `realId` has a row.
function makeDb() {
  const users = [{ user_id: realId, first_name: 'Grace', last_name: 'Hopper' }];
  const db: any = vi.fn((table: string) => {
    if (table !== 'users') throw new Error(`unexpected table ${table}`);
    const chain: any = {
      _ids: null as string[] | null,
      where: (w: any) => { chain._one = w.user_id; return chain; },
      whereIn: (_c: string, ids: string[]) => { chain._ids = ids; return chain; },
      first: async () => users.find((u) => u.user_id === chain._one),
      select: async () => users.filter((u) => chain._ids?.includes(u.user_id)),
    };
    return chain;
  });
  return db;
}

vi.mock('@alga-psa/db', async (orig) => {
  const actual: any = await orig();
  return { ...actual, tenantDb: (conn: any) => ({ table: (n: string) => conn(n), tenantJoin: (q: any) => q }) };
});

const change = (userId?: string) => ({ timestamp: new Date().toISOString(), userId, changes: { title: { old: 'a', new: 'b' } } });

describe('ticketEmailSubscriber updater rendering', () => {
  it('renders System for a changeSet with no userId', async () => {
    const html = await formatAccumulatedChanges(makeDb(), [change(undefined)] as any, tenant);
    expect(html).toContain('System');
  });

  it('never renders a UUID for an updater id with no users row', async () => {
    const html = await formatAccumulatedChanges(makeDb(), [change(ghostId)] as any, tenant);
    expect(html).toContain('System');
    expect(html).not.toContain(ghostId);
  });

  it('renders the real name for a known user', async () => {
    const html = await formatAccumulatedChanges(makeDb(), [change(realId)] as any, tenant);
    expect(html).toContain('Grace Hopper');
  });

  it('Updated By: System with no userIds; unknown ids collapse to one System; real names kept', async () => {
    const db = makeDb();
    expect(await resolveUpdatedByDisplay(db, tenant, [change(undefined)] as any)).toBe('System');
    const ghost2 = randomUUID();
    const out = await resolveUpdatedByDisplay(db, tenant, [change(ghostId), change(ghost2), change(realId)] as any);
    expect(out).toBe('System, Grace Hopper');
    expect(out).not.toContain(ghostId);
  });
});
