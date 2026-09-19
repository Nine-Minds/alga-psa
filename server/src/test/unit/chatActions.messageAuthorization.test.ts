import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const runWithTenantMock = vi.hoisted(() =>
  vi.fn(async (_tenant: string, fn: () => Promise<unknown>) => fn()),
);
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getByChatIdForUserMock = vi.hoisted(() => vi.fn());
const updateMessageMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock('@ee/models/message', () => ({
  __esModule: true,
  default: {
    getByChatIdForUser: getByChatIdForUserMock,
    update: updateMessageMock,
  },
}));

vi.mock('@ee/models/chat', () => ({
  __esModule: true,
  default: {},
}));

const USER = { user_id: 'user-1', tenant: 'tenant-1' };

const makePersistenceAvailable = () => {
  createTenantKnexMock.mockResolvedValue({
    knex: { schema: { hasTable: vi.fn(async () => true) } },
    tenant: 'tenant-1',
  });
};

const loadChatActions = async () => {
  vi.resetModules();
  return import('@ee/lib/chat-actions/chatActions');
};

describe('EE chat action authorization boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
    getCurrentUserMock.mockReset();
    getByChatIdForUserMock.mockReset();
    updateMessageMock.mockReset();
  });

  describe('getChatMessagesAction', () => {
    it('rejects anonymous callers instead of returning empty history', async () => {
      makePersistenceAvailable();
      getCurrentUserMock.mockResolvedValue(null);

      const { getChatMessagesAction } = await loadChatActions();
      await expect(getChatMessagesAction('chat-1')).rejects.toThrow('Not authenticated');
      expect(getByChatIdForUserMock).not.toHaveBeenCalled();
    });

    it('rejects callers without a user id', async () => {
      makePersistenceAvailable();
      getCurrentUserMock.mockResolvedValue({ tenant: 'tenant-1' });

      const { getChatMessagesAction } = await loadChatActions();
      await expect(getChatMessagesAction('chat-1')).rejects.toThrow('Not authenticated');
      expect(getByChatIdForUserMock).not.toHaveBeenCalled();
    });

    it('rejects callers without a tenant before querying messages', async () => {
      makePersistenceAvailable();
      getCurrentUserMock.mockResolvedValue({ user_id: 'user-1' });

      const { getChatMessagesAction } = await loadChatActions();
      await expect(getChatMessagesAction('chat-1')).rejects.toThrow('Missing tenant for chat action');
      expect(getByChatIdForUserMock).not.toHaveBeenCalled();
    });

    it('denies anonymous empty-id requests before any persistence access', async () => {
      makePersistenceAvailable();
      getCurrentUserMock.mockResolvedValue(null);

      const { getChatMessagesAction } = await loadChatActions();
      await expect(getChatMessagesAction('')).rejects.toThrow('Not authenticated');
      expect(createTenantKnexMock).not.toHaveBeenCalled();
      expect(getByChatIdForUserMock).not.toHaveBeenCalled();
    });

    it('reads messages for the authenticated owner inside the tenant context', async () => {
      makePersistenceAvailable();
      getCurrentUserMock.mockResolvedValue(USER);
      getByChatIdForUserMock.mockResolvedValue([{ id: 'm-1' }]);

      const { getChatMessagesAction } = await loadChatActions();
      await expect(getChatMessagesAction('chat-1')).resolves.toEqual([{ id: 'm-1' }]);

      expect(runWithTenantMock).toHaveBeenCalledWith('tenant-1', expect.any(Function));
      expect(getByChatIdForUserMock).toHaveBeenCalledWith('chat-1', 'user-1');
    });

    it('propagates an ownership denial instead of reporting empty history', async () => {
      makePersistenceAvailable();
      getCurrentUserMock.mockResolvedValue(USER);
      const { ChatAccessDeniedError } = await import('@ee/lib/chat-actions/errors');
      getByChatIdForUserMock.mockRejectedValue(new ChatAccessDeniedError());

      const { getChatMessagesAction } = await loadChatActions();
      await expect(getChatMessagesAction('chat-1')).rejects.toThrow('Chat access denied');
    });

    it('reports a persistence outage as empty history (distinct from a denial)', async () => {
      makePersistenceAvailable();
      getCurrentUserMock.mockResolvedValue(USER);
      getByChatIdForUserMock.mockRejectedValue({ code: '42703' });

      const { getChatMessagesAction } = await loadChatActions();
      await expect(getChatMessagesAction('chat-1')).resolves.toEqual([]);
    });
  });

  describe('updateMessageAction', () => {
    it('rejects anonymous callers', async () => {
      makePersistenceAvailable();
      getCurrentUserMock.mockResolvedValue(null);

      const { updateMessageAction } = await loadChatActions();
      await expect(updateMessageAction('m-1', { content: 'x' })).rejects.toThrow('Not authenticated');
      expect(updateMessageMock).not.toHaveBeenCalled();
    });

    it('rejects callers without a tenant', async () => {
      makePersistenceAvailable();
      getCurrentUserMock.mockResolvedValue({ user_id: 'user-1' });

      const { updateMessageAction } = await loadChatActions();
      await expect(updateMessageAction('m-1', { content: 'x' })).rejects.toThrow(
        'Missing tenant for chat action',
      );
      expect(updateMessageMock).not.toHaveBeenCalled();
    });

    it('denies anonymous empty-id requests before any persistence access', async () => {
      makePersistenceAvailable();
      getCurrentUserMock.mockResolvedValue(null);

      const { updateMessageAction } = await loadChatActions();
      await expect(updateMessageAction('', { content: 'x' })).rejects.toThrow('Not authenticated');
      expect(createTenantKnexMock).not.toHaveBeenCalled();
      expect(updateMessageMock).not.toHaveBeenCalled();
    });

    it('forwards only allowlisted mutable columns for the authenticated caller', async () => {
      makePersistenceAvailable();
      getCurrentUserMock.mockResolvedValue(USER);
      updateMessageMock.mockResolvedValue(1);

      const { updateMessageAction } = await loadChatActions();
      const result = await updateMessageAction('m-1', {
        content: 'edited',
        thumb: null,
        feedback: null,
        message_order: 0,
        tenant: 'attacker-tenant',
        chat_id: 'other-chat',
        chat_role: 'system',
        id: 'other-id',
      } as never);

      expect(result).toBe('success');
      expect(updateMessageMock).toHaveBeenCalledWith(
        'm-1',
        { content: 'edited', thumb: null, feedback: null, message_order: 0 },
        'user-1',
      );
    });

    it('treats a payload with no allowlisted columns as a no-op', async () => {
      makePersistenceAvailable();
      getCurrentUserMock.mockResolvedValue(USER);

      const { updateMessageAction } = await loadChatActions();
      const result = await updateMessageAction('m-1', {
        tenant: 'attacker-tenant',
        chat_role: 'system',
      } as never);

      expect(result).toBe('skipped');
      expect(updateMessageMock).not.toHaveBeenCalled();
    });

    it('reports a non-owned or missing message as unauthorized, not skipped', async () => {
      makePersistenceAvailable();
      getCurrentUserMock.mockResolvedValue(USER);
      updateMessageMock.mockResolvedValue(0);

      const { updateMessageAction } = await loadChatActions();
      await expect(updateMessageAction('m-1', { content: 'x' })).resolves.toBe('unauthorized');
    });

    it('reports a persistence outage as skipped (distinct from a denial)', async () => {
      makePersistenceAvailable();
      getCurrentUserMock.mockResolvedValue(USER);
      updateMessageMock.mockRejectedValue({ code: '42703' });

      const { updateMessageAction } = await loadChatActions();
      await expect(updateMessageAction('m-1', { content: 'x' })).resolves.toBe('skipped');
    });
  });

  describe('authentication precedes cached persistence availability', () => {
    const makePersistenceUnavailable = () => {
      createTenantKnexMock.mockResolvedValue({
        knex: { schema: { hasTable: vi.fn(async () => false) } },
        tenant: 'tenant-1',
      });
    };

    it('denies anonymous reads and updates after the unavailable status is cached', async () => {
      makePersistenceUnavailable();
      getCurrentUserMock.mockResolvedValue(USER);

      const { getChatMessagesAction, updateMessageAction } = await loadChatActions();
      await expect(getChatMessagesAction('chat-1')).resolves.toEqual([]);
      await expect(updateMessageAction('m-1', { content: 'x' })).resolves.toBe('skipped');
      const persistenceProbes = createTenantKnexMock.mock.calls.length;

      getCurrentUserMock.mockResolvedValue(null);
      await expect(getChatMessagesAction('chat-1')).rejects.toThrow('Not authenticated');
      await expect(updateMessageAction('m-1', { content: 'x' })).rejects.toThrow('Not authenticated');

      expect(createTenantKnexMock.mock.calls.length).toBe(persistenceProbes);
      expect(getByChatIdForUserMock).not.toHaveBeenCalled();
      expect(updateMessageMock).not.toHaveBeenCalled();
    });

    it('denies an empty id even when persistence is known unavailable', async () => {
      makePersistenceUnavailable();
      getCurrentUserMock.mockResolvedValue(USER);

      const { getChatMessagesAction, updateMessageAction } = await loadChatActions();
      await getChatMessagesAction('chat-1');
      await updateMessageAction('m-1', { content: 'x' });

      getCurrentUserMock.mockResolvedValue(null);
      await expect(getChatMessagesAction('')).rejects.toThrow('Not authenticated');
      await expect(updateMessageAction('', { content: 'x' })).rejects.toThrow('Not authenticated');
    });
  });
});
