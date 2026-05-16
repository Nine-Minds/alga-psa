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

vi.mock('@alga-psa/shared/inboundWebhooks/externalEntityMappings', () => ({
  lookupAlgaEntityByExternalId: mocks.lookupAlgaEntityByExternalId,
  writeEntityMapping: mocks.writeEntityMapping,
}));

async function loadTicketInboundActions() {
  vi.resetModules();
  await import('@alga-psa/tickets/actions/inboundActions');
  return import('@alga-psa/shared/inboundWebhooks/actions/registry');
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
    mocks.lookupAlgaEntityByExternalId.mockResolvedValue({
      algaEntityId: 'ticket-1',
      externalEntityId: 'alert-42',
      metadata: {},
    });
    mocks.updateTicket.mockResolvedValue({
      ticket_id: 'ticket-1',
      ticket_number: 'T-100',
    });
    mocks.createComment.mockResolvedValue({
      ticket_id: 'ticket-1',
      comment_id: 'comment-1',
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

  it('T1013: updateTicketByExternalId resolves the ticket mapping and updates mapped fields', async () => {
    const { getAction } = await loadTicketInboundActions();
    const action = getAction('updateTicketByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'rmm-alerts',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { alert: { id: 'alert-42', severity: 'critical' } },
          idempotencyKey: 'alert-42',
        },
        {
          external_id: 'alert-42',
          status_id: 'status-triage',
          priority_id: 'priority-critical',
          assigned_to: 'user-1',
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'ticket',
      entityId: 'ticket-1',
      externalId: 'alert-42',
      metadata: {
        updated_fields: ['status_id', 'priority_id', 'assigned_to'],
      },
    });

    expect(mocks.lookupAlgaEntityByExternalId).toHaveBeenCalledWith(
      'tenant-a',
      'rmm-alerts',
      'ticket',
      'alert-42',
      { knex: 'trx' },
    );
    expect(mocks.updateTicket).toHaveBeenCalledWith(
      'ticket-1',
      {
        status_id: 'status-triage',
        priority_id: 'priority-critical',
        assigned_to: 'user-1',
      },
      'tenant-a',
      'trx',
    );
  });

  it('T1014: updateTicketByExternalId returns lookup_miss when no mapping exists', async () => {
    mocks.lookupAlgaEntityByExternalId.mockResolvedValue(null);
    const { getAction } = await loadTicketInboundActions();
    const action = getAction('updateTicketByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'rmm-alerts',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { alert: { id: 'missing-alert' } },
          idempotencyKey: 'missing-alert',
        },
        {
          external_id: 'missing-alert',
          status_id: 'status-triage',
        },
      ),
    ).resolves.toEqual({
      success: false,
      entityType: 'ticket',
      externalId: 'missing-alert',
      message: 'lookup_miss: ticket external_id "missing-alert" is not mapped for webhook "rmm-alerts"',
    });

    expect(mocks.updateTicket).not.toHaveBeenCalled();
  });

  it('T1015: addTicketCommentByExternalId appends a comment to the mapped ticket', async () => {
    const { getAction } = await loadTicketInboundActions();
    const action = getAction('addTicketCommentByExternalId');

    await expect(
      action?.handle(
        {
          tenant: 'tenant-a',
          webhookSlug: 'rmm-alerts',
          deliveryId: 'delivery-1',
          headers: {},
          rawBody: { alert: { id: 'alert-42', details: 'Investigating' } },
          idempotencyKey: 'alert-42',
        },
        {
          external_id: 'alert-42',
          content: 'Investigating disk pressure.',
          is_internal: false,
          author_id: 'user-1',
        },
      ),
    ).resolves.toEqual({
      success: true,
      entityType: 'ticket',
      entityId: 'ticket-1',
      externalId: 'alert-42',
      metadata: {
        comment_id: 'comment-1',
      },
    });

    expect(mocks.lookupAlgaEntityByExternalId).toHaveBeenCalledWith(
      'tenant-a',
      'rmm-alerts',
      'ticket',
      'alert-42',
      { knex: 'trx' },
    );
    expect(mocks.createComment).toHaveBeenCalledWith(
      {
        ticket_id: 'ticket-1',
        content: 'Investigating disk pressure.',
        is_internal: false,
        is_resolution: false,
        author_type: 'internal',
        author_id: 'user-1',
        contact_id: undefined,
        metadata: {
          inbound_webhook_delivery_id: 'delivery-1',
          inbound_webhook_slug: 'rmm-alerts',
          external_id: 'alert-42',
        },
      },
      'tenant-a',
      'trx',
    );
  });

  it('T1016: changeTicketStatusByExternalId delegates valid status changes and propagates invalid status errors', async () => {
    mocks.updateTicket.mockResolvedValueOnce({
      ticket_id: 'ticket-1',
      status_id: 'status-closed',
    });
    const { getAction } = await loadTicketInboundActions();
    const action = getAction('changeTicketStatusByExternalId');
    const ctx = {
      tenant: 'tenant-a',
      webhookSlug: 'rmm-alerts',
      deliveryId: 'delivery-1',
      headers: {},
      rawBody: { alert: { id: 'alert-42', status: 'closed' } },
      idempotencyKey: 'alert-42',
    };

    await expect(
      action?.handle(ctx, {
        external_id: 'alert-42',
        status_id: 'status-closed',
        board_id: 'board-2',
      }),
    ).resolves.toEqual({
      success: true,
      entityType: 'ticket',
      entityId: 'ticket-1',
      externalId: 'alert-42',
      metadata: {
        status_id: 'status-closed',
      },
    });
    expect(mocks.updateTicket).toHaveBeenCalledWith(
      'ticket-1',
      {
        status_id: 'status-closed',
        board_id: 'board-2',
      },
      'tenant-a',
      'trx',
    );

    mocks.updateTicket.mockRejectedValueOnce(new Error('Invalid status for board'));

    await expect(
      action?.handle(ctx, {
        external_id: 'alert-42',
        status_id: 'status-invalid',
      }),
    ).rejects.toThrow('Invalid status for board');
  });
});
