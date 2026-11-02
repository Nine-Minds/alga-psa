import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  candidates: [] as Array<Record<string, unknown>>,
  authorized: [] as string[],
  fetches: [] as Array<{ after: unknown; limit: number; filters: unknown }>,
}));

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
  return { fields: [] };
} }));
vi.mock('../nativeMeetingRead', () => ({ nativeInteractionMeetingView: async () => null }));
vi.mock('../localAuthentication', () => ({
  lockCoManagedLocalAuthentication: async () => ({ subject: 'subject', assertCurrent: async () => undefined }),
  snapshotCoManagedAuthenticatedActor: (actor: unknown) => actor,
}));
vi.mock('../sharedWorkIdentity', () => ({
  authorizeCoManagedLocalRecord: async () => ({ redactedFields: [] }),
  CoManagedSharedWorkError: class extends Error {},
  isCoManagedUuid: () => true,
}));
vi.mock('../sharedWorkRedaction', () => ({ isCoManagedReadFieldHidden: () => false }));
vi.mock('../nativeInteractionCandidates', () => ({
  nativeInteractionCandidates: (_owner: unknown, filters: unknown, after: { interaction_date: Date | null; interaction_id: string } | null, _options: unknown, limit: number) => {
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
      client_id: 'client-a',
      title: index === 99 ? 'visible needle' : `interaction ${index}`,
    }));
    harness.authorized = [];
    harness.fetches = [];
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
    expect(result.nextCursor?.interaction_id).toBe('interaction-099');
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
    expect(result.nextCursor?.interaction_id).toBe('interaction-009');

    const next = await readCoManagedNativeInteractions({} as never, 'tenant-a', async () => ({
      kind: 'session', tenant: 'tenant-a', userId: 'user-a', sessionId: 'session-a',
    }), { paginated: true, filters: { pageSize: 10, cursor: result.nextCursor } });
    expect(next.handled).toBe(true);
    if (!next.handled) return;
    expect(next.interactions.map(row => row.interaction_id)).toEqual(['interaction-010', 'interaction-011']);
    expect(next.totalExact).toBe(true);
    expect(next.hasMore).toBe(false);
  });
});
