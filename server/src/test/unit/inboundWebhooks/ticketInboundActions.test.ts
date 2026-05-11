import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(),
  createTicketWithRetry: vi.fn(),
  updateTicket: vi.fn(),
  createComment: vi.fn(),
  lookupAlgaEntityByExternalId: vi.fn(),
  writeEntityMapping: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  withTransaction: mocks.withTransaction,
}));

vi.mock('@alga-psa/shared/models/ticketModel', () => ({
  TicketModel: {
    createTicketWithRetry: mocks.createTicketWithRetry,
    updateTicket: mocks.updateTicket,
    createComment: mocks.createComment,
  },
}));

vi.mock('@/lib/inboundWebhooks/externalEntityMappings', () => ({
  lookupAlgaEntityByExternalId: mocks.lookupAlgaEntityByExternalId,
  writeEntityMapping: mocks.writeEntityMapping,
}));

async function loadTicketInboundActions() {
  vi.resetModules();
  await import('@alga-psa/tickets/actions/inboundActions');
  return import('@/lib/inboundWebhooks/actions/registry');
}

describe('ticket inbound webhook actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTenantKnex.mockResolvedValue({ knex: 'tenant-knex' });
    mocks.withTransaction.mockImplementation(async (_knex: unknown, callback: (trx: unknown) => unknown) =>
      callback('trx'),
    );
    mocks.createTicketWithRetry.mockResolvedValue({
      ticket_id: 'ticket-1',
      ticket_number: 'T-100',
    });
  });

  it('T1010: createTicket creates a tenant-scoped ticket from mapped fields', async () => {
    const { getAction } = await loadTicketInboundActions();
    const action = getAction('createTicket');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'rmm-alerts',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { alert: { message: 'Disk full' } },
          idempotencyKey: 'alert-42',
        },
        {
          title: 'Disk full',
          description: 'The system drive is full.',
          client_id: 'client-1',
          board_id: 'board-1',
          status_id: 'status-new',
          priority_id: 'priority-critical',
          assigned_to: 'user-1',
          attributes: { severity: 'critical' },
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'ticket',
      entityId: 'ticket-1',
      externalId: undefined,
      metadata: {
        ticket_number: 'T-100',
      },
    });

    expect(mocks.createTenantKnex).toHaveBeenCalledWith('tenant-a');
    expect(mocks.withTransaction).toHaveBeenCalledWith('tenant-knex', expect.any(Function));
    expect(mocks.createTicketWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Disk full',
        description: 'The system drive is full.',
        client_id: 'client-1',
        board_id: 'board-1',
        status_id: 'status-new',
        priority_id: 'priority-critical',
        assigned_to: 'user-1',
        attributes: {
          severity: 'critical',
          inbound_webhook_delivery_id: 'delivery-1',
          inbound_webhook_slug: 'rmm-alerts',
        },
        source: 'webhook',
        ticket_origin: 'api',
      }),
      'tenant-a',
      'trx',
      {},
      undefined,
      undefined,
      undefined,
      3,
    );
    expect(mocks.writeEntityMapping).not.toHaveBeenCalled();
  });

  it('T1011: createTicket writes an external mapping when external_id is mapped', async () => {
    const { getAction } = await loadTicketInboundActions();
    const action = getAction('createTicket');

    await action?.handle(
      {
        tenant: 'tenant-a',
        webhookSlug: 'rmm-alerts',
        deliveryId: 'delivery-1',
        headers: {},
        rawBody: { alert: { id: 'alert-42', message: 'Disk full' } },
        idempotencyKey: 'alert-42',
      },
      {
        title: 'Disk full',
        client_id: 'client-1',
        board_id: 'board-1',
        priority_id: 'priority-critical',
        external_id: 'alert-42',
      },
    );

    expect(mocks.writeEntityMapping).toHaveBeenCalledWith(
      'tenant-a',
      'rmm-alerts',
      'ticket',
      'ticket-1',
      'alert-42',
      {
        knex: 'trx',
        metadata: {
          source: 'inbound_webhook',
          delivery_id: 'delivery-1',
        },
      },
    );
  });
});
