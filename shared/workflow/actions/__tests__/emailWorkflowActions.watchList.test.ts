import { beforeEach, describe, expect, it, vi } from 'vitest';

const withAdminTransactionMock = vi.fn();
const addRecipientsMock = vi.fn();
const publishWorkflowEventMock = vi.fn();
const trxMock: any = vi.fn(() => {
  throw new Error('upsertTicketWatchListRecipients must not touch tables directly');
});

vi.mock('@alga-psa/db', () => ({
  withAdminTransaction: (callback: (trx: any) => Promise<any>, existing?: unknown) =>
    withAdminTransactionMock(callback, existing),
  tenantDb: (trx: any) => ({
    table: (tableName: string) => trx(tableName),
  }),
}));

vi.mock('../../../services/tickets/ticketWatcherService', () => {
  class TicketWatcherError extends Error {
    constructor(readonly kind: string) {
      super(kind);
    }
  }
  return {
    TicketWatcherError,
    TicketWatcherService: { addRecipients: (...args: any[]) => addRecipientsMock(...args) },
  };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: (...args: any[]) => publishWorkflowEventMock(...args),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

// Merge/dedupe semantics now live in TicketWatcherService and are covered by
// server/src/test/integration/ticketWatchers.integration.test.ts; this suite only
// proves the inbound path delegates to it (the table is the source of truth).
describe('upsertTicketWatchListRecipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) =>
      callback(trxMock)
    );
  });

  it('T025: delegates recipients to TicketWatcherService.addRecipients inside the admin transaction', async () => {
    addRecipientsMock.mockResolvedValue({
      changed: true,
      watchers: [
        { email: 'existing@example.com', name: null, active: true, entity_type: null, entity_id: null, source: 'manual' },
        { email: 'new@example.com', name: 'New Watcher', active: true, entity_type: null, entity_id: null, source: 'inbound_cc' },
      ],
    });
    const { upsertTicketWatchListRecipients } = await import('../emailWorkflowActions');

    const recipients = [
      { email: 'existing@example.com', source: 'inbound_to' },
      { email: 'new@example.com', source: 'inbound_cc', name: 'New Watcher' },
    ];
    const result = await upsertTicketWatchListRecipients({ ticketId: 'ticket-1', recipients }, 'tenant-1');

    expect(addRecipientsMock).toHaveBeenCalledWith(trxMock, 'tenant-1', 'ticket-1', recipients, null);
    expect(result.updated).toBe(true);
    expect(result.watchList).toEqual([
      { email: 'existing@example.com', active: true, source: 'manual' },
      { email: 'new@example.com', active: true, source: 'inbound_cc', name: 'New Watcher' },
    ]);
  });

  it('T026: reports updated=false when the service made no change', async () => {
    addRecipientsMock.mockResolvedValue({ changed: false, watchers: [] });
    const { upsertTicketWatchListRecipients } = await import('../emailWorkflowActions');

    const result = await upsertTicketWatchListRecipients(
      { ticketId: 'ticket-1', recipients: [{ email: 'not-an-email' }, { email: null }, { email: '' }] },
      'tenant-1'
    );

    expect(result.updated).toBe(false);
  });

  it('T060: passes entity metadata through and maps it back into the watch list', async () => {
    addRecipientsMock.mockResolvedValue({
      changed: true,
      watchers: [
        {
          email: 'picker.user@example.com',
          name: 'Picker User',
          active: true,
          entity_type: 'user',
          entity_id: 'user-77',
          source: 'manual',
        },
      ],
    });
    const { upsertTicketWatchListRecipients } = await import('../emailWorkflowActions');

    const recipient = {
      email: 'picker.user@example.com',
      source: 'manual',
      name: 'Picker User',
      entity_type: 'user' as const,
      entity_id: 'user-77',
    };
    const result = await upsertTicketWatchListRecipients({ ticketId: 'ticket-1', recipients: [recipient] }, 'tenant-1');

    expect(addRecipientsMock.mock.calls[0][3]).toEqual([recipient]);
    expect(result.watchList).toEqual([
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

  it('T061: a missing ticket is a no-op, not an error', async () => {
    const { TicketWatcherError } = await import('../../../services/tickets/ticketWatcherService');
    addRecipientsMock.mockRejectedValue(new (TicketWatcherError as any)('ticket_not_found'));
    const { upsertTicketWatchListRecipients } = await import('../emailWorkflowActions');

    const result = await upsertTicketWatchListRecipients({ ticketId: 'missing', recipients: [{ email: 'a@b.co' }] }, 'tenant-1');

    expect(result).toEqual({ updated: false, watchList: [] });
  });
});
