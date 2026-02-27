import { beforeEach, describe, expect, it, vi } from 'vitest';

const withAdminTransactionMock = vi.fn();
const updateMock = vi.fn();
const publishWorkflowEventMock = vi.fn();
let firstRow: { attributes?: unknown } | undefined;

const ticketsBuilder: any = {
  select: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  first: vi.fn(async () => firstRow),
  update: vi.fn(async (...args: any[]) => updateMock(...args)),
};

const trxMock = vi.fn((table: string) => {
  if (table !== 'tickets') {
    throw new Error(`Unexpected table access in test: ${table}`);
  }
  return ticketsBuilder;
});

vi.mock('@alga-psa/db', () => ({
  withAdminTransaction: (callback: (trx: any) => Promise<any>) =>
    withAdminTransactionMock(callback),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: (...args: any[]) => publishWorkflowEventMock(...args),
}));

describe('upsertTicketWatchListRecipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) =>
      callback(trxMock)
    );
    firstRow = {
      attributes: {
        watch_list: [{ email: 'existing@example.com', active: false, source: 'manual' }],
      },
    };
    updateMock.mockResolvedValue(1);
  });

  it('T025: upsert watch-list recipients writes expected JSON in tickets.attributes.watch_list', async () => {
    const { upsertTicketWatchListRecipients } = await import('../emailWorkflowActions');

    const result = await upsertTicketWatchListRecipients(
      {
        ticketId: 'ticket-1',
        recipients: [
          { email: 'existing@example.com', source: 'inbound_to' },
          { email: 'new@example.com', source: 'inbound_cc', name: 'New Watcher' },
        ],
      },
      'tenant-1'
    );

    expect(result.updated).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const updatePayload = updateMock.mock.calls[0][0];
    expect(updatePayload).toHaveProperty('attributes');

    const parsedAttributes = JSON.parse(updatePayload.attributes);
    expect(parsedAttributes.watch_list).toEqual([
      {
        email: 'existing@example.com',
        active: true,
        source: 'manual',
      },
      {
        email: 'new@example.com',
        active: true,
        source: 'inbound_cc',
        name: 'New Watcher',
      },
    ]);
  });

  it('T026: upsert with only invalid recipients performs no ticket attribute mutation', async () => {
    const { upsertTicketWatchListRecipients } = await import('../emailWorkflowActions');

    const result = await upsertTicketWatchListRecipients(
      {
        ticketId: 'ticket-1',
        recipients: [{ email: 'not-an-email' }, { email: null }, { email: '' }],
      },
      'tenant-1'
    );

    expect(result.updated).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('T060: upsert persists entity metadata in tickets.attributes.watch_list for picker-added entries', async () => {
    firstRow = {
      attributes: {
        watch_list: [],
      },
    };

    const { upsertTicketWatchListRecipients } = await import('../emailWorkflowActions');

    const result = await upsertTicketWatchListRecipients(
      {
        ticketId: 'ticket-1',
        recipients: [
          {
            email: 'picker.user@example.com',
            source: 'manual',
            name: 'Picker User',
            entity_type: 'user',
            entity_id: 'user-77',
          },
        ],
      },
      'tenant-1'
    );

    expect(result.updated).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const parsedAttributes = JSON.parse(updateMock.mock.calls[0][0].attributes);
    expect(parsedAttributes.watch_list).toEqual([
      {
        email: 'picker.user@example.com',
        active: true,
        source: 'manual',
        name: 'Picker User',
        entity_type: 'user',
        entity_id: 'user-77',
      },
    ]);
  });

  it('T061: upsert ignores recipient inputs with metadata but no valid email', async () => {
    const { upsertTicketWatchListRecipients } = await import('../emailWorkflowActions');

    const result = await upsertTicketWatchListRecipients(
      {
        ticketId: 'ticket-1',
        recipients: [
          {
            email: '',
            source: 'manual',
            name: 'Missing Email',
            entity_type: 'contact',
            entity_id: 'contact-22',
          },
          {
            email: null,
            entity_type: 'user',
            entity_id: 'user-88',
          },
        ],
      },
      'tenant-1'
    );

    expect(result.updated).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
