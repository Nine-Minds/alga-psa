/**
 * alga-2026-0002941: `openWarrantyClaimFromTicket` is the only entry that links a caller-chosen ticket. It must hand the
 * inventory flow the ticket-aware schema and the REAL ticket record check as the required authorizer port.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ flow: vi.fn(), record: vi.fn(), canReadTickets: true }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...a: any[]) => unknown) => (...args: unknown[]) => fn({ user_id: 'u1', user_type: 'internal' }, { tenant: 't1' }, ...args),
  hasPermission: async () => m.canReadTickets,
}));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: vi.fn() }));
vi.mock('@alga-psa/tickets/lib/ticketRecordAuthorization', () => ({ authorizeTicketRecordAccess: m.record }));
vi.mock('@alga-psa/tickets/actions/externalLinks/externalLinkActions', () => ({
  addExternalLink: vi.fn(), getTicketExternalLinks: vi.fn(), removeExternalLink: vi.fn(), updateExternalLink: vi.fn(),
}));
vi.mock('@alga-psa/inventory/lib/rma/openWarrantyClaimRunner', () => ({ openWarrantyClaimFlow: m.flow }));
vi.mock('@alga-psa/inventory/actions/rmaActions', () => ({ getRmaCase: vi.fn() }));

import { openWarrantyClaimForTicketSchema } from '@alga-psa/inventory/lib/rma/warrantySchemas';
import { openWarrantyClaimFromTicket } from '../rmaTicketActions';

const TICKET = '33333333-3333-4333-8333-333333333333';
const input = { asset_id: '22222222-2222-4222-8222-222222222222', reason: 'x', ticket_id: TICKET };

beforeEach(() => { m.flow.mockReset(); m.record.mockReset(); m.canReadTickets = true; });

describe('openWarrantyClaimFromTicket', () => {
  it('runs the flow with the ticket-aware schema and an authorizer backed by authorizeTicketRecordAccess', async () => {
    m.flow.mockResolvedValue({ rma_id: 'r1' });
    await openWarrantyClaimFromTicket(input);
    const [, tenant, raw, schema, authorizeTicket] = m.flow.mock.calls[0];
    expect(tenant).toBe('t1');
    expect(raw).toBe(input);
    expect(schema).toBe(openWarrantyClaimForTicketSchema);

    const trx = {};
    m.record.mockResolvedValue({});
    await authorizeTicket(trx, TICKET, 'read');
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ trx, tenant: 't1', ticketId: TICKET, action: 'read' }));

    m.record.mockRejectedValue(new Error('Permission denied: Cannot access ticket'));
    await expect(authorizeTicket(trx, TICKET, 'read')).rejects.toThrow('Permission denied');
  });

  it('refuses without ticket:read before touching the flow', async () => {
    m.canReadTickets = false;
    expect(await openWarrantyClaimFromTicket(input)).toHaveProperty('permissionError');
    expect(m.flow).not.toHaveBeenCalled();
  });
});
