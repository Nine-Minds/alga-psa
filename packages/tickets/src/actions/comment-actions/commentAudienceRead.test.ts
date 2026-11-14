import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ served: vi.fn(), arrangement: vi.fn(), threads: [] as any[], ticket: { client_id: 'client-1' } as any, tableCalls: [] as string[] }));

vi.mock('@alga-psa/core/capability', () => ({ isCapabilityServed: mocks.served }));
vi.mock('@alga-psa/db', () => ({
  liveSeatArrangement: mocks.arrangement,
  tenantDb: () => ({
    table: (name: string) => {
      mocks.tableCalls.push(name);
      const chain: any = {
        where: () => chain,
        whereIn: () => chain,
        select: async () => mocks.threads,
        first: async () => mocks.ticket,
      };
      return chain;
    },
  }),
}));

import { attachThreadAudiences, attachThreadAudiencesOnSeatTicket } from './commentAudienceRead';

const comments = [
  { comment_id: 'a', thread_id: 't-req', is_internal: false },
  { comment_id: 'b', thread_id: 't-shared', is_internal: true },
  { comment_id: 'c', thread_id: 't-legacy', is_internal: true },
] as any[];

describe('attachThreadAudiences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tableCalls.length = 0;
    mocks.threads = [
      { thread_id: 't-req', is_internal: false, collaboration_audience: null },
      { thread_id: 't-shared', is_internal: true, collaboration_audience: 'shared_it' },
      { thread_id: 't-legacy', is_internal: true, collaboration_audience: null },
    ];
  });

  it('labels each comment with its thread\'s read-time audience; a legacy internal note is private', async () => {
    const result = await attachThreadAudiences({} as any, 't1', comments);
    expect(result.map((c) => c.audience)).toEqual(['requester', 'shared_it', 'organization_private']);
  });

  it('reads nothing for a ticket without threads', async () => {
    expect(await attachThreadAudiences({} as any, 't1', [{ comment_id: 'x' } as any])).toHaveLength(1);
    expect(mocks.tableCalls).toEqual([]);
  });

  describe('attachThreadAudiencesOnSeatTicket', () => {
    it('does nothing and reads nothing while the seat capability is closed', async () => {
      mocks.served.mockResolvedValue(false);
      expect(await attachThreadAudiencesOnSeatTicket({} as any, 't1', 'ticket-1', comments)).toBe(comments);
      expect(mocks.tableCalls).toEqual([]);
      expect(mocks.arrangement).not.toHaveBeenCalled();
    });

    it('leaves a ticket of a client without a live arrangement unlabelled', async () => {
      mocks.served.mockResolvedValue(true);
      mocks.arrangement.mockResolvedValue(undefined);
      expect(await attachThreadAudiencesOnSeatTicket({} as any, 't1', 'ticket-1', comments)).toBe(comments);
      expect(mocks.tableCalls).toEqual(['tickets']);
    });

    it('labels the comments of an arrangement client\'s ticket', async () => {
      mocks.served.mockResolvedValue(true);
      mocks.arrangement.mockResolvedValue({ arrangement_id: 'arr-1' });
      const result = await attachThreadAudiencesOnSeatTicket({} as any, 't1', 'ticket-1', comments);
      expect(result.map((c) => c.audience)).toEqual(['requester', 'shared_it', 'organization_private']);
    });
  });
});
