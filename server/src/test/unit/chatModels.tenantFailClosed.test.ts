import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/db/tenant', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createTenantKnex: createTenantKnexMock,
  };
});

import Message from '@ee/models/message';
import Chat from '@ee/models/chat';

const createKnexSpy = () => {
  const knexMock = vi.fn((table: string) => {
    throw new Error(`Unscoped query executed against ${table}`);
  }) as unknown as Record<string, unknown>;
  knexMock.transaction = vi.fn(async (callback: (trx: unknown) => Promise<unknown>) =>
    callback(knexMock),
  );
  return knexMock;
};

describe('EE chat models fail closed without tenant context', () => {
  beforeEach(() => {
    createTenantKnexMock.mockReset();
  });

  it('message reads reject before any query is issued', async () => {
    const knexMock = createKnexSpy();
    createTenantKnexMock.mockResolvedValue({ knex: knexMock, tenant: null });

    await expect(Message.getAll()).rejects.toThrow('Missing tenant for message model');
    await expect(Message.getByChatId('chat-1')).rejects.toThrow('Missing tenant for message model');
    await expect(Message.get('message-1')).rejects.toThrow('Missing tenant for message model');

    expect(knexMock).not.toHaveBeenCalled();
  });

  it('message update rejects before any query is issued', async () => {
    const knexMock = createKnexSpy();
    createTenantKnexMock.mockResolvedValue({ knex: knexMock, tenant: undefined });

    await expect(Message.update('message-1', { content: 'x' }, 'user-1')).rejects.toThrow(
      'Missing tenant for message model',
    );

    expect(knexMock).not.toHaveBeenCalled();
  });

  it('message insert still requires a tenant', async () => {
    const knexMock = createKnexSpy();
    createTenantKnexMock.mockResolvedValue({ knex: knexMock, tenant: null });

    await expect(
      Message.insert({
        chat_id: 'chat-1',
        chat_role: 'user',
        content: 'hello',
        thumb: null,
        feedback: null,
      }),
    ).rejects.toThrow('Missing tenant for message insert');

    expect(knexMock).not.toHaveBeenCalled();
  });

  it('chat reads reject before any query is issued', async () => {
    const knexMock = createKnexSpy();
    createTenantKnexMock.mockResolvedValue({ knex: knexMock, tenant: null });

    await expect(Chat.getAll()).rejects.toThrow('Missing tenant for chat model');
    await expect(Chat.get('chat-1')).rejects.toThrow('Missing tenant for chat model');
    await expect(Chat.getRecentByUser('user-1', 20)).rejects.toThrow('Missing tenant for chat model');
    await expect(Chat.searchByUser('user-1', 'printer', 20)).rejects.toThrow(
      'Missing tenant for chat model',
    );
    await expect(Chat.updateTitleForUser('chat-1', 'user-1', 'title')).rejects.toThrow(
      'Missing tenant for chat model',
    );
    await expect(Chat.deleteForUser('chat-1', 'user-1')).rejects.toThrow('Missing tenant for chat model');

    expect(knexMock).not.toHaveBeenCalled();
  });
});
