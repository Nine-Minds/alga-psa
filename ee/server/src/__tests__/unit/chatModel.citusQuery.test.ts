import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';

const createTenantKnexMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

import Chat from '../../models/chat';

const sqlKnex = knexFactory({ client: 'pg' });

afterAll(async () => {
  await sqlKnex.destroy();
});

describe('Chat model Citus-safe query shapes', () => {
  beforeEach(() => {
    createTenantKnexMock.mockReset();
  });

  it('uses the facade helper for the recent chat preview correlation', async () => {
    const chatsBuilder: Record<string, any> = {};
    chatsBuilder.select = vi.fn(() => chatsBuilder);
    chatsBuilder.where = vi.fn(() => chatsBuilder);
    chatsBuilder.orderByRaw = vi.fn(() => chatsBuilder);
    chatsBuilder.orderBy = vi.fn(() => chatsBuilder);
    chatsBuilder.limit = vi.fn(async () => []);
    const rawMock = vi.fn((sql: string, bindings?: any) => sqlKnex.raw(sql, bindings));

    const knexMock = Object.assign(
      vi.fn((table: string) => {
        if (table === 'messages as m') {
          return sqlKnex(table);
        }

        if (table !== 'chats') {
          throw new Error(`Unexpected table ${table}`);
        }

        return chatsBuilder;
      }),
      {
        raw: rawMock,
      }
    ) as any;

    createTenantKnexMock.mockResolvedValue({ knex: knexMock, tenant: 'tenant-1' });

    await Chat.getRecentByUser('user-1', 20);

    expect(rawMock).toHaveBeenCalledTimes(1);
    expect(rawMock.mock.calls[0][0]).toMatch(
      /where "m"\."chat_id" = "chats"\."id"\s+and "m"\."tenant" = "chats"\."tenant"/i
    );
    expect(rawMock.mock.calls[0][1]).toEqual([1]);
    expect(rawMock.mock.calls[0][0]).not.toMatch(/\bm\.tenant\s*=\s*chats\.tenant\b/i);
    expect(chatsBuilder.where).toHaveBeenCalledWith({ user_id: 'user-1' });
    expect(chatsBuilder.limit).toHaveBeenCalledWith(20);
  });

  it('uses facade-built chat search message correlations', async () => {
    const rawMock = vi.fn((sql: string, bindings?: any) => {
      if (/with search_query/i.test(sql)) {
        return Promise.resolve({ rows: [] });
      }

      return sqlKnex.raw(sql, bindings);
    });

    const knexMock = Object.assign(
      vi.fn((table: string) => sqlKnex(table)),
      {
        raw: rawMock,
      }
    ) as any;

    createTenantKnexMock.mockResolvedValue({ knex: knexMock, tenant: 'tenant-1' });

    await Chat.searchByUser('user-1', 'printer', 20);

    const searchCall = rawMock.mock.calls.find(([sql]) => /with search_query/i.test(sql));
    expect(searchCall?.[0]).toMatch(
      /"m_latest"\."chat_id" = "chats"\."id"\s+and "m_latest"\."tenant" = "chats"\."tenant"/i
    );
    expect(searchCall?.[0]).toMatch(
      /"m_aggregate"\."chat_id" = "chats"\."id"\s+and "m_aggregate"\."tenant" = "chats"\."tenant"/i
    );
    expect(searchCall?.[1]).toEqual(['printer', 1, 'user-1', 20]);
    expect(searchCall?.[0]).not.toMatch(/\bm_latest\.tenant\s*=\s*chats\.tenant\b/i);
    expect(searchCall?.[0]).not.toMatch(/\bm_aggregate\.tenant\s*=\s*chats\.tenant\b/i);
  });
});
