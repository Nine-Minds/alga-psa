import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateTicketInput } from '@shared/models/ticketModel';

const h = vi.hoisted(() => {
  const tenant = '22222222-2222-4222-8222-222222222222';
  const ticketId = '11111111-1111-4111-8111-111111111111';
  const reloadedTicket: Record<string, unknown> = {
    ticket_id: ticketId,
    ticket_number: 'TIC-1000',
    title: 'Forwarded create',
    client_id: '33333333-3333-4333-8333-333333333333',
    board_id: '44444444-4444-4444-8444-444444444444',
    status_id: '55555555-5555-4555-8555-555555555555',
    priority_id: '66666666-6666-4666-8666-666666666666',
    url: null,
    severity_id: null,
    urgency_id: null,
    impact_id: null,
    entered_at: '2026-09-19T12:00:00.000Z',
  };
  const builder = {
    where: vi.fn(() => builder),
    first: vi.fn(async () => reloadedTicket),
    insert: vi.fn(async () => undefined),
  };
  const fakeTenantDb = { table: vi.fn(() => builder) };
  // `TicketService.createTicket` opens its transaction and immediately calls
  // `assertCoManagedOperationalWrite`, which refuses a handle that does not
  // declare itself a transaction. A stub standing in for a transaction has to
  // say so, or the suite fails before reaching the create-field forwarding it
  // is about.
  return { tenant, ticketId, reloadedTicket, builder, fakeTenantDb, fakeTrx: { isTransaction: true } };
});

// Co-managed lifecycle admission now runs at every operational write boundary,
// including this one. This suite is about create-field forwarding and says
// nothing about co-management, so it takes the shared double, whose default is
// an independent workspace: writable, not co-managed, admission a no-op. The
// guard itself is covered by packages/licensing's own suites -- doubling it
// here is the documented pattern (packages/db/src/testing/coManagedLifecycle.ts),
// not a relaxation of it.
vi.mock('@alga-psa/licensing', async (importOriginal) => {
  const { coManagedLifecycleMock } = await import('@alga-psa/db/testing');
  return {
    ...(await importOriginal<object>()),
    ...coManagedLifecycleMock({ fn: (implementation) => vi.fn(implementation as never) as never }),
  };
});

// `withTransaction` runs the caller's callback against a stub handle so the
// real TicketService.createTicket orchestration executes without a database.
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    withTransaction: (async (_knex: unknown, cb: (trx: unknown) => unknown) => cb(h.fakeTrx)) as any,
    tenantDb: (() => h.fakeTenantDb) as any,
  };
});

// The create path persists base ticket-level links; this suite forwards fields
// only, so isolate that side effect.
vi.mock('@alga-psa/tickets/actions/externalLinks/externalLinkPersistence', () => ({
  persistExternalLinksForCreate: vi.fn(async () => []),
  publishExternalLinkEvent: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/shared/lib/ticketActivity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/lib/ticketActivity')>();
  return { ...actual, writeTicketActivity: vi.fn(async () => undefined) };
});

import { TicketService } from '../../../lib/api/services/TicketService';
import { TicketModel } from '@shared/models/ticketModel';

describe('TicketService.create forwards create fields', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(TicketModel, 'validateStatusBelongsToBoard').mockResolvedValue({ valid: true } as any);
  });

  it('passes url, severity_id, urgency_id and impact_id to TicketModel and returns the reloaded values', async () => {
    const url = 'https://support.example.com/tickets/forwarded';
    const severity = '77777777-7777-4777-8777-777777777777';
    const urgency = '88888888-8888-4888-8888-888888888888';
    const impact = '99999999-9999-4999-8999-999999999999';

    const createSpy = vi
      .spyOn(TicketModel, 'createTicketWithRetry')
      .mockImplementation(async (input: CreateTicketInput) => {
        // Simulate the database round trip: persist what the service forwarded
        // and let the service reload it.
        h.reloadedTicket.url = input.url ?? null;
        h.reloadedTicket.severity_id = input.severity_id ?? null;
        h.reloadedTicket.urgency_id = input.urgency_id ?? null;
        h.reloadedTicket.impact_id = input.impact_id ?? null;
        return { ticket_id: h.ticketId } as any;
      });

    const service = new TicketService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
    vi.spyOn(service as any, 'safePublishEvent').mockResolvedValue(undefined);

    const context = { tenant: h.tenant, userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } as any;
    const result = await service.create(
      {
        title: 'Forwarded create',
        client_id: h.reloadedTicket.client_id,
        board_id: h.reloadedTicket.board_id,
        status_id: h.reloadedTicket.status_id,
        priority_id: h.reloadedTicket.priority_id,
        url,
        severity_id: severity,
        urgency_id: urgency,
        impact_id: impact,
      } as any,
      context,
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    const forwarded = createSpy.mock.calls[0][0] as CreateTicketInput;
    expect(forwarded.url).toBe(url);
    expect(forwarded.severity_id).toBe(severity);
    expect(forwarded.urgency_id).toBe(urgency);
    expect(forwarded.impact_id).toBe(impact);
    expect(forwarded.entered_by).toBe(context.userId);

    expect(result).toMatchObject({
      ticket_id: h.ticketId,
      url,
      severity_id: severity,
      urgency_id: urgency,
      impact_id: impact,
    });
  });
});
