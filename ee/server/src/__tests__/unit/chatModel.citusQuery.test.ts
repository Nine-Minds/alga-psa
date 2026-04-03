import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

import Chat from '../../models/chat';

describe('Chat model Citus-safe query shapes', () => {
  beforeEach(() => {
    createTenantKnexMock.mockReset();
  });

  it('adds tenant to the recent chat preview correlation', async () => {
    const limitMock = vi.fn(async () => []);
    const orderByMock = vi.fn(() => ({
      limit: limitMock,
    }));
    const orderByRawMock = vi.fn(() => ({
      orderBy: orderByMock,
    }));
    const whereMock = vi.fn(() => ({
      orderByRaw: orderByRawMock,
    }));
    const selectMock = vi.fn(() => ({
      where: whereMock,
    }));
    const rawMock = vi.fn((sql: string) => sql);

    const knexMock = Object.assign(
      vi.fn((table: string) => {
        if (table !== 'chats') {
          throw new Error(`Unexpected table ${table}`);
        }

        return {
          select: selectMock,
        };
      }),
      {
        raw: rawMock,
      }
    ) as any;

    createTenantKnexMock.mockResolvedValue({ knex: knexMock, tenant: 'tenant-1' });

    await Chat.getRecentByUser('user-1', 20);

    expect(rawMock).toHaveBeenCalledTimes(1);
    expect(rawMock.mock.calls[0][0]).toMatch(
      /where m\.chat_id = chats\.id\s+and m\.tenant = chats\.tenant/i
    );
    expect(whereMock).toHaveBeenCalledWith({ user_id: 'user-1' });
    expect(limitMock).toHaveBeenCalledWith(20);
  });
});
