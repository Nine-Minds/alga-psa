import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateTicketInput } from '@shared/models/ticketModel';
import { isSilentTicketCreation } from '@alga-psa/shared/lib/tickets/ticketLifecycleEvents';

const h = vi.hoisted(() => {
  const tenant = '22222222-2222-4222-8222-222222222222';
  const ticketId = '11111111-1111-4111-8111-111111111111';
  const reloadedTicket: Record<string, unknown> = {
    ticket_id: ticketId,
    ticket_number: 'TIC-1000',
    title: 'Historical create',
    client_id: '33333333-3333-4333-8333-333333333333',
    board_id: '44444444-4444-4444-8444-444444444444',
    status_id: '55555555-5555-4555-8555-555555555555',
    priority_id: '66666666-6666-4666-8666-666666666666',
    entered_at: '2025-03-14T09:30:00.000Z',
    is_closed: false,
  };
  const builder = {
    where: vi.fn(() => builder),
    first: vi.fn(async () => reloadedTicket),
    insert: vi.fn(async () => undefined),
  };
  const fakeTenantDb = { table: vi.fn(() => builder) };
  return { tenant, ticketId, reloadedTicket, fakeTenantDb, fakeTrx: {}, writeTicketActivity: vi.fn(async () => undefined), audit: vi.fn(async () => true) };
});

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    withTransaction: (async (_knex: unknown, cb: (trx: unknown) => unknown) => cb(h.fakeTrx)) as any,
    tenantDb: (() => h.fakeTenantDb) as any,
  };
});

vi.mock('@alga-psa/tickets/actions/externalLinks/externalLinkPersistence', () => ({
  persistExternalLinksForCreate: vi.fn(async () => [{ link_id: 'link-1' }]),
  publishExternalLinkEvent: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/shared/lib/ticketActivity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/lib/ticketActivity')>();
  return { ...actual, writeTicketActivity: h.writeTicketActivity };
});

vi.mock('@alga-psa/shared/lib/ticketCloseRules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/lib/ticketCloseRules')>();
  return { ...actual, auditCloseRulesBypassIfGated: h.audit };
});

import { TicketService } from '../../../lib/api/services/TicketService';
import { TicketModel } from '@shared/models/ticketModel';
import { ForbiddenError, ValidationError } from '../../../lib/api/middleware/apiMiddleware';
import { publishExternalLinkEvent } from '@alga-psa/tickets/actions/externalLinks/externalLinkPersistence';

const requestBody = (extra: Record<string, unknown> = {}) =>
  ({
    title: 'Historical create',
    client_id: h.reloadedTicket.client_id,
    board_id: h.reloadedTicket.board_id,
    status_id: h.reloadedTicket.status_id,
    priority_id: h.reloadedTicket.priority_id,
    ...extra,
  }) as any;

const internalContext = { tenant: h.tenant, userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user: { user_type: 'internal' } } as any;

describe('TicketService.create historical import', () => {
  let service: TicketService;
  let createSpy: ReturnType<typeof vi.spyOn>;
  let publishSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    h.writeTicketActivity.mockClear();
    h.audit.mockClear();
    vi.mocked(publishExternalLinkEvent).mockClear();
    h.reloadedTicket.is_closed = false;
    vi.spyOn(TicketModel, 'validateStatusBelongsToBoard').mockResolvedValue({ valid: true } as any);
    createSpy = vi.spyOn(TicketModel, 'createTicketWithRetry').mockResolvedValue({ ticket_id: h.ticketId } as any);
    service = new TicketService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
    publishSpy = vi.spyOn(service as any, 'safePublishEvent').mockResolvedValue(undefined);
  });

  it('forwards entered_at as historical with source api_import and the silent publisher', async () => {
    await service.create(requestBody({ entered_at: '2025-03-14T09:30:00Z' }), internalContext);

    const forwarded = createSpy.mock.calls[0][0] as CreateTicketInput;
    expect(forwarded.historical).toEqual({
      entered_at: '2025-03-14T09:30:00Z',
      closed_at: undefined,
      closed_by: undefined,
    });
    expect(forwarded.source).toBe('api_import');
    const publisher = createSpy.mock.calls[0][4];
    expect(isSilentTicketCreation(publisher)).toBe(true);
    expect((publisher as any).kind).toBe('silent');
  });

  it('does not publish TICKET_CREATED for a historical ticket, but keeps TICKET_EXTERNAL_LINK_ADDED', async () => {
    await service.create(requestBody({ entered_at: '2025-03-14T09:30:00Z' }), internalContext);

    expect(publishSpy).not.toHaveBeenCalledWith('TICKET_CREATED', expect.anything(), expect.anything());
    expect(publishExternalLinkEvent).toHaveBeenCalledTimes(1);
  });

  it('still publishes TICKET_CREATED, with the caller-published publisher, when entered_at is absent', async () => {
    await service.create(requestBody(), internalContext);

    const forwarded = createSpy.mock.calls[0][0] as CreateTicketInput;
    expect(forwarded.historical).toBeUndefined();
    expect(forwarded.source).toBe('api');
    expect((createSpy.mock.calls[0][4] as any).kind).toBe('caller_published');
    expect(publishSpy).toHaveBeenCalledWith('TICKET_CREATED', internalContext, expect.anything());
  });

  it('defaults closed_by to the API user when closed_at is supplied', async () => {
    await service.create(
      requestBody({ entered_at: '2025-03-14T09:30:00Z', closed_at: '2025-03-15T09:30:00Z' }),
      internalContext,
    );
    const forwarded = createSpy.mock.calls[0][0] as CreateTicketInput;
    expect(forwarded.historical).toEqual({
      entered_at: '2025-03-14T09:30:00Z',
      closed_at: '2025-03-15T09:30:00Z',
      closed_by: internalContext.userId,
    });
  });

  it('writes the CREATED activity row at entered_at flagged historical_import', async () => {
    await service.create(requestBody({ entered_at: '2025-03-14T09:30:00Z' }), internalContext);

    expect(h.writeTicketActivity).toHaveBeenCalledTimes(1);
    const row = (h.writeTicketActivity.mock.calls[0] as any[])[1];
    expect(row.occurredAt).toBe(h.reloadedTicket.entered_at);
    expect(row.details.historical_import).toBe(true);
  });

  it('leaves the activity row stamped now (no occurredAt) for a live create', async () => {
    await service.create(requestBody(), internalContext);
    const row = (h.writeTicketActivity.mock.calls[0] as any[])[1];
    expect(row).not.toHaveProperty('occurredAt');
    expect(row.details).not.toHaveProperty('historical_import');
  });

  it('records the close-rules bypass for a closed historical ticket only', async () => {
    h.reloadedTicket.is_closed = true;
    await service.create(
      requestBody({ entered_at: '2025-03-14T09:30:00Z', closed_at: '2025-03-15T09:30:00Z' }),
      internalContext,
    );
    expect(h.audit).toHaveBeenCalledTimes(1);
    expect(h.audit.mock.calls[0][4]).toBe('api_import');

    h.audit.mockClear();
    h.reloadedTicket.is_closed = false;
    await service.create(requestBody({ entered_at: '2025-03-14T09:30:00Z' }), internalContext);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it('returns 403 to a non-internal caller that supplies entered_at, before touching the model', async () => {
    const clientContext = { ...internalContext, user: { user_type: 'client' } };
    await expect(
      service.create(requestBody({ entered_at: '2025-03-14T09:30:00Z' }), clientContext),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('maps a model historical invariant error to a 400 with the field path', async () => {
    createSpy.mockRejectedValue(
      new Error('Invalid historical ticket [closed_at]: closed_at is required when status_id is a closed status'),
    );
    const error = await service
      .create(requestBody({ entered_at: '2025-03-14T09:30:00Z' }), internalContext)
      .catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as any).details).toEqual([
      { path: ['closed_at'], message: 'closed_at is required when status_id is a closed status' },
    ]);
  });

  it('rejects a closed_by that is not a user in the tenant with a 400 on closed_by, before creating', async () => {
    const builder: any = h.fakeTenantDb.table();
    builder.first.mockResolvedValueOnce(undefined);
    const error = await service
      .create(
        requestBody({
          entered_at: '2025-03-14T09:30:00Z',
          closed_at: '2025-03-15T09:30:00Z',
          closed_by: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }),
        internalContext,
      )
      .catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as any).details).toEqual([
      { path: ['closed_by'], message: 'closed_by must be a user in this tenant' },
    ]);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('accepts a closed_by that is a tenant user', async () => {
    await service.create(
      requestBody({
        entered_at: '2025-03-14T09:30:00Z',
        closed_at: '2025-03-15T09:30:00Z',
        closed_by: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
      internalContext,
    );
    expect((createSpy.mock.calls[0][0] as CreateTicketInput).historical?.closed_by).toBe(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    );
  });
});
