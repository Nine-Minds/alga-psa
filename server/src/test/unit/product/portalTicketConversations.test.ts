import type { Knex } from 'knex';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ ensure: vi.fn(), list: vi.fn(), read: vi.fn() }));
vi.mock('../../../../../shared/lib/tickets/namedConversations', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../../shared/lib/tickets/namedConversations')>(),
  ensureDefaultTicketConversation: storage.ensure,
  listStoredTicketConversations: storage.list,
  readStoredTicketConversation: storage.read,
}));
import { readPortalTicketConversations } from '../../../../../shared/lib/tickets/portalTicketConversations';

const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ticketId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const defaultId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const selectedId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const trx = { isTransaction: true } as Knex.Transaction;
const scope = { trx, storeTenant: tenant, ticket: { tenant, ticketId } };
const requester = { conversationId: defaultId, audience: 'requester', name: 'Requester', defaultSlot: 'requester', status: 'open' };
const delivery = { conversationId: selectedId, audience: 'requester', name: 'Delivery', defaultSlot: null, status: 'done',
  storeTenant: tenant, relationshipId: 'private relationship', mailbox: 'private routing' };

beforeEach(() => {
  vi.resetAllMocks();
  storage.ensure.mockResolvedValue(requester);
  storage.list.mockResolvedValue([delivery, requester]);
  storage.read.mockResolvedValue(delivery);
});

describe('portal conversation projection', () => {
  it('selects only requester conversations in the admitted tenant and locks the publication audience', async () => {
    const result = await readPortalTicketConversations(trx, tenant, ticketId, selectedId.toUpperCase(), 'update');
    expect(storage.ensure).toHaveBeenCalledWith(scope, 'requester');
    expect(storage.list).toHaveBeenCalledWith(scope, ['requester']);
    expect(storage.read).toHaveBeenCalledWith(scope, selectedId, 'update');
    expect(result).toEqual({ selectedConversationId: selectedId, requesterConversations: [
      { conversationId: defaultId, name: 'Requester', isDefault: true, status: 'open' },
      { conversationId: selectedId, name: 'Delivery', isDefault: false, status: 'done' },
    ] });
  });

  it('defaults to the requester conversation and retains a read lock', async () => {
    storage.read.mockResolvedValue(requester);
    expect((await readPortalTicketConversations(trx, tenant, ticketId)).selectedConversationId).toBe(defaultId);
    expect(storage.read).toHaveBeenCalledWith(scope, defaultId, 'read');
  });

  it('rejects a conversation outside the requester list before reading its contents', async () => {
    storage.list.mockResolvedValue([requester]);
    await expect(readPortalTicketConversations(trx, tenant, ticketId, selectedId)).rejects.toMatchObject({ code: 'CONVERSATION_FORBIDDEN' });
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('rejects an audience changed after listing instead of exposing it to the portal', async () => {
    storage.read.mockResolvedValue({ ...delivery, audience: 'internal' });
    await expect(readPortalTicketConversations(trx, tenant, ticketId, selectedId)).rejects.toMatchObject({ code: 'CONVERSATION_FORBIDDEN' });
  });

  it('rejects invalid selection and missing transaction before accessing storage', async () => {
    await expect(readPortalTicketConversations(trx, tenant, ticketId, 'invalid')).rejects.toMatchObject({ code: 'CONVERSATION_INVALID' });
    await expect(readPortalTicketConversations({} as Knex.Transaction, tenant, ticketId)).rejects.toMatchObject({ code: 'CONVERSATION_INVALID' });
    expect(storage.ensure).not.toHaveBeenCalled();
    expect(storage.list).not.toHaveBeenCalled();
  });
});
