import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  candidates: [] as Array<Record<string, unknown>>,
  authorized: [] as string[],
  fetches: [] as Array<{ after: unknown; limit: number; filters: unknown }>,
  denied: new Set<string>(),
  redactDate: false,
}));
const CoManagedSharedWorkError = vi.hoisted(() => class extends Error {});

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (table: string) => ({
      where: (_column: string, id: string) => ({
        forShare: () => ({ first: async () => table === 'interactions' ? harness.candidates.find(row => row.interaction_id === id) : undefined }),
      }),
    }),
  }),
  withTransaction: async (_db: unknown, work: (trx: unknown) => Promise<unknown>) => work({}),
}));
vi.mock('../nativeWorkspace', () => ({ retainCoManagedWorkspace: async () => true }));
vi.mock('../nativeScheduleRead', () => ({ retainScheduleSource: async (_trx: unknown, _actor: unknown, _subject: unknown, target: { work_item_id: string }) => {
  harness.authorized.push(target.work_item_id);
  if (harness.denied.has(target.work_item_id)) throw new CoManagedSharedWorkError();
  return { fields: [] };
} }));
vi.mock('../nativeMeetingRead', () => ({ nativeInteractionMeetingView: async () => null }));
vi.mock('../localAuthentication', () => ({
  lockCoManagedLocalAuthentication: async () => ({ subject: 'subject', assertCurrent: async () => undefined }),
  snapshotCoManagedAuthenticatedActor: (actor: unknown) => actor,
}));
vi.mock('../sharedWorkIdentity', () => ({
  authorizeCoManagedLocalRecord: async () => ({ redactedFields: [] }),
  CoManagedSharedWorkError,
  isCoManagedUuid: () => true,
}));
vi.mock('../sharedWorkRedaction', () => ({ isCoManagedReadFieldHidden: (_fields: unknown, keys: string[]) => harness.redactDate && keys.some(key => key === 'interaction_date') }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecret: async () => 'test-cursor-secret' }));
vi.mock('../nativeInteractionCandidates', () => ({
  nativeInteractionCandidates: (_owner: unknown, filters: unknown, after: { interaction_date_sort_key: string | null; interaction_id: string } | null, _options: unknown, limit: number) => {
    harness.fetches.push({ after, limit, filters });
    const start = after ? harness.candidates.findIndex(row => row.interaction_id === after.interaction_id) + 1 : 0;
    return Promise.resolve(harness.candidates.slice(start, start + limit));
  },
}));

import { readCoManagedNativeInteractions } from '../nativeInteractionRead';

describe('co-managed native interaction paging', () => {
  beforeEach(() => {
    harness.candidates = Array.from({ length: 400 }, (_, index) => ({
      interaction_id: `interaction-${String(index).padStart(3, '0')}`,
      interaction_date: new Date(Date.UTC(2026, 0, 1) - index * 1_000),
      interaction_date_sort_key: new Date(Date.UTC(2026, 0, 1) - index * 1_000).toISOString().replace(/\.(\d{3})Z$/, (_match, millis) => `.${millis}000Z`),
      client_id: 'client-a',
      title: index === 99 ? 'visible needle' : `interaction ${index}`,
    }));
    harness.authorized = [];
    harness.fetches = [];
    harness.denied = new Set();
    harness.redactDate = false;
  });

  it('authorizes bounded windows, applies search after authorization, and marks the separate count as incomplete', async () => {
    const result = await readCoManagedNativeInteractions({} as never, 'tenant-a', async () => ({
      kind: 'session', tenant: 'tenant-a', userId: 'user-a', sessionId: 'session-a',
    }), { paginated: true, filters: { pageSize: 10, search: 'needle', clientId: 'client-a' } });

    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0].interaction_id).toBe('interaction-099');
    expect(result.total).toBe(0); // The independent count window does not reach the matching row.
    expect(result.totalExact).toBe(false);
    expect(harness.authorized).toHaveLength(200); // 3 result windows + 1 count window.
    expect(harness.fetches).toHaveLength(4);
    expect(harness.fetches.every(fetch => fetch.limit === 50)).toBe(true);
    expect(harness.fetches.every(fetch => (fetch.filters as { clientId: string }).clientId === 'client-a')).toBe(true);
    expect(result.nextCursor).toBeTruthy();
    expect(result.nextCursor).not.toContain('interaction-099');
  });

  it('returns an exact total when the authorized candidate set is exhausted within the count budget', async () => {
    harness.candidates = harness.candidates.slice(0, 12);
    const result = await readCoManagedNativeInteractions({} as never, 'tenant-a', async () => ({
      kind: 'session', tenant: 'tenant-a', userId: 'user-a', sessionId: 'session-a',
    }), { paginated: true, filters: { pageSize: 10 } });

    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.interactions.map(row => row.interaction_id)).toEqual(harness.candidates.slice(0, 10).map(row => row.interaction_id));
    expect(result.total).toBe(12);
    expect(result.totalExact).toBe(true);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeTruthy();
    expect(result.nextCursor).not.toContain('interaction-009');

    const next = await readCoManagedNativeInteractions({} as never, 'tenant-a', async () => ({
      kind: 'session', tenant: 'tenant-a', userId: 'user-a', sessionId: 'session-a',
    }), { paginated: true, filters: { pageSize: 10, cursor: result.nextCursor } });
    expect(next.handled).toBe(true);
    if (!next.handled) return;
    expect(next.interactions.map(row => row.interaction_id)).toEqual(['interaction-010', 'interaction-011']);
    expect(next.totalExact).toBe(true);
    expect(next.hasMore).toBe(false);
    await expect(readCoManagedNativeInteractions({} as never, 'tenant-a', async () => ({
      kind: 'session', tenant: 'tenant-a', userId: 'user-a', sessionId: 'session-a',
    }), { paginated: true, filters: { pageSize: 10, clientId: 'client-b', cursor: result.nextCursor } }))
      .rejects.toThrow('Invalid interaction continuation');
  });

  it('uses the list default and honors the maximum page size without exceeding the candidate budget', async () => {
    const identify = async () => ({
      kind: 'session' as const, tenant: 'tenant-a', userId: 'user-a', sessionId: 'session-a',
    });
    const defaultPage = await readCoManagedNativeInteractions({} as never, 'tenant-a', identify, { paginated: true });
    expect(defaultPage.handled).toBe(true);
    if (!defaultPage.handled) return;
    expect(defaultPage.pageSize).toBe(10);
    expect(defaultPage.interactions).toHaveLength(10);

    harness.fetches = [];
    const maximumPage = await readCoManagedNativeInteractions({} as never, 'tenant-a', identify, {
      paginated: true, filters: { pageSize: 100 },
    });
    expect(maximumPage.handled).toBe(true);
    if (!maximumPage.handled) return;
    expect(maximumPage.pageSize).toBe(100);
    expect(maximumPage.interactions).toHaveLength(100);
    expect(harness.fetches.every(fetch => fetch.limit === 50)).toBe(true);
    expect(harness.fetches).toHaveLength(4); // Three result windows and one bounded total window.
  });

  it('refuses a request above the list maximum before reading candidates', async () => {
    await expect(readCoManagedNativeInteractions({} as never, 'tenant-a', async () => ({
      kind: 'session', tenant: 'tenant-a', userId: 'user-a', sessionId: 'session-a',
    }), { paginated: true, filters: { pageSize: 101 } })).rejects.toThrow();
    expect(harness.fetches).toHaveLength(0);
  });

  it('keeps denied-window progress in an opaque continuation without exposing denied IDs or dates', async () => {
    harness.denied = new Set(harness.candidates.slice(0, 150).map(row => String(row.interaction_id)));
    const result = await readCoManagedNativeInteractions({} as never, 'tenant-a', async () => ({
      kind: 'session', tenant: 'tenant-a', userId: 'user-a', sessionId: 'session-a',
    }), { paginated: true, filters: { pageSize: 10 } });

    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.interactions).toHaveLength(0);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeTruthy();
    expect(result.nextCursor).not.toContain('interaction-149');
    expect(result.nextCursor).not.toContain('2026-01-01');
    const next = await readCoManagedNativeInteractions({} as never, 'tenant-a', async () => ({
      kind: 'session', tenant: 'tenant-a', userId: 'user-a', sessionId: 'session-a',
    }), { paginated: true, filters: { pageSize: 10, cursor: result.nextCursor } });
    expect(next.handled).toBe(true);
    if (!next.handled) return;
    expect(next.interactions[0]?.interaction_id).toBe('interaction-150');
  });

  it('continues from an authorized row with a redacted date without exposing its position', async () => {
    harness.candidates = harness.candidates.slice(0, 12);
    harness.redactDate = true;
    const result = await readCoManagedNativeInteractions({} as never, 'tenant-a', async () => ({
      kind: 'session', tenant: 'tenant-a', userId: 'user-a', sessionId: 'session-a',
    }), { paginated: true, filters: { pageSize: 1 } });

    expect(result.handled).toBe(true);
    if (!result.handled) return;
    expect(result.interactions[0]).not.toHaveProperty('interaction_date');
    expect(result.nextCursor).toBeTruthy();
    expect(result.nextCursor).not.toContain('interaction-000');
    expect(result.nextCursor).not.toContain('2026-01-01');
    const next = await readCoManagedNativeInteractions({} as never, 'tenant-a', async () => ({
      kind: 'session', tenant: 'tenant-a', userId: 'user-a', sessionId: 'session-a',
    }), { paginated: true, filters: { pageSize: 1, cursor: result.nextCursor } });
    expect(next.handled).toBe(true);
    if (!next.handled) return;
    expect(next.interactions[0]?.interaction_id).toBe('interaction-001');
  });

  it('rejects malformed and query-replayed continuations before fetching candidates', async () => {
    await expect(readCoManagedNativeInteractions({} as never, 'tenant-a', async () => ({
      kind: 'session', tenant: 'tenant-a', userId: 'user-a', sessionId: 'session-a',
    }), { paginated: true, filters: { cursor: 'interaction-049' } })).rejects.toThrow('Invalid interaction continuation');
    expect(harness.fetches).toHaveLength(0);
  });
});
