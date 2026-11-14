import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ statusIsClosed: false }));

// The model reads the status row's is_closed through tenantDb(trx, tenant).table('statuses').
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  const builder: any = {
    where: () => builder,
    first: async () => ({ is_closed: h.statusIsClosed }),
  };
  return { ...actual, tenantDb: (() => ({ table: () => builder })) as any };
});

import { TicketModel, buildTicketCreateRow } from '@alga-psa/shared/models/ticketModel';
import {
  silentTicketCreation,
  ticketCreatedPublishedByCaller,
} from '@alga-psa/shared/lib/tickets/ticketLifecycleEvents';

const UUID = {
  ticket: '11111111-1111-4111-8111-111111111111',
  tenant: '22222222-2222-4222-8222-222222222222',
  user: '33333333-3333-4333-8333-333333333333',
  board: '44444444-4444-4444-8444-444444444444',
  client: '55555555-5555-4555-8555-555555555555',
  status: '66666666-6666-4666-8666-666666666666',
  priority: '77777777-7777-4777-8777-777777777777',
};

const BASE = {
  ticket_id: UUID.ticket,
  tenant: UUID.tenant,
  ticket_number: 'TIC-1000',
  entered_at: '2025-03-14T09:30:00.000Z',
  updated_at: '2026-10-12T12:00:00.000Z',
};

const input = (historical?: any) => ({
  title: 'Imported',
  board_id: UUID.board,
  client_id: UUID.client,
  status_id: UUID.status,
  priority_id: UUID.priority,
  ...(historical ? { historical } : {}),
});

describe('TicketModel historical creation: row mapping', () => {
  it('writes is_closed, closed_at and closed_by for a closed historical ticket', () => {
    const row = buildTicketCreateRow(BASE, {
      cleanedInput: input({ entered_at: BASE.entered_at, closed_at: '2025-03-15T10:00:00Z', closed_by: UUID.user }),
      historicalStatusIsClosed: true,
      resolvedBillingProfileId: null,
      attributes: null,
    });
    expect(row.entered_at).toBe(BASE.entered_at);
    expect(row.is_closed).toBe(true);
    expect(row.closed_at).toBe('2025-03-15T10:00:00Z');
    expect(row.closed_by).toBe(UUID.user);
  });

  it('leaves the closed columns out for an open historical ticket', () => {
    const row = buildTicketCreateRow(BASE, {
      cleanedInput: input({ entered_at: BASE.entered_at }),
      historicalStatusIsClosed: false,
      resolvedBillingProfileId: null,
      attributes: null,
    });
    expect(row).not.toHaveProperty('is_closed');
    expect(row).not.toHaveProperty('closed_at');
    expect(row).not.toHaveProperty('closed_by');
  });

  it('leaves the closed columns out for a non-historical create (tickets are created open)', () => {
    const row = buildTicketCreateRow(BASE, {
      cleanedInput: { ...input(), closed_at: '2025-03-15T10:00:00Z', closed_by: UUID.user, is_closed: true },
      resolvedBillingProfileId: null,
      attributes: null,
    });
    expect(row).not.toHaveProperty('is_closed');
    expect(row).not.toHaveProperty('closed_at');
    expect(row).not.toHaveProperty('closed_by');
  });
});

describe('TicketModel.createTicket historical invariants', () => {
  const trx = {} as any;
  const silent = silentTicketCreation('test import');

  beforeEach(() => {
    h.statusIsClosed = false;
    vi.restoreAllMocks();
    vi.spyOn(TicketModel, 'validateBusinessRules').mockResolvedValue({ valid: true });
  });

  const create = (historical: any, publisher: any = silent) =>
    TicketModel.createTicket(input(historical) as any, UUID.tenant, trx, {}, publisher, undefined, UUID.user);

  it('refuses a non-silent publisher', async () => {
    await expect(
      create({ entered_at: '2025-03-14T09:30:00Z' }, { publishTicketCreated: vi.fn() }),
    ).rejects.toThrow(/historical.*silentTicketCreation/);
  });

  it('refuses a caller-published publisher (it would publish TICKET_CREATED itself)', async () => {
    await expect(
      create({ entered_at: '2025-03-14T09:30:00Z' }, ticketCreatedPublishedByCaller('caller publishes')),
    ).rejects.toThrow(/silentTicketCreation/);
  });

  it('rejects a future entered_at', async () => {
    await expect(create({ entered_at: '2999-01-01T00:00:00Z' })).rejects.toThrow(
      /Invalid historical ticket \[entered_at\].*future/,
    );
  });

  it('rejects closed_at before entered_at', async () => {
    h.statusIsClosed = true;
    await expect(
      create({ entered_at: '2025-03-14T09:30:00Z', closed_at: '2025-03-13T09:30:00Z' }),
    ).rejects.toThrow(/\[closed_at\].*before entered_at/);
  });

  it('rejects a future closed_at', async () => {
    h.statusIsClosed = true;
    await expect(
      create({ entered_at: '2025-03-14T09:30:00Z', closed_at: '2999-01-01T00:00:00Z' }),
    ).rejects.toThrow(/\[closed_at\].*future/);
  });

  it('requires closed_at for a closed status', async () => {
    h.statusIsClosed = true;
    await expect(create({ entered_at: '2025-03-14T09:30:00Z' })).rejects.toThrow(
      /\[closed_at\].*required when status_id is a closed status/,
    );
  });

  it('rejects closed_at for an open status', async () => {
    h.statusIsClosed = false;
    await expect(
      create({ entered_at: '2025-03-14T09:30:00Z', closed_at: '2025-03-15T09:30:00Z' }),
    ).rejects.toThrow(/\[closed_at\].*only allowed when status_id is a closed status/);
  });

  it('rejects closed_by for an open status', async () => {
    await expect(
      create({ entered_at: '2025-03-14T09:30:00Z', closed_by: UUID.user }),
    ).rejects.toThrow(/\[closed_by\]/);
  });
});
