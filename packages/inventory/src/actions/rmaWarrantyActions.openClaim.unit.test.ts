/**
 * alga-2026-0002941: the browser-facing `openWarrantyClaim` accepts no `ticket_id`, and the only ticket it can link
 * (open custody's) is authorized with the real ticket record check plus `ticket:read`. The success path still links
 * an authorized ticket and returns the reloaded row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  core: vi.fn(),
  record: vi.fn(),
  perms: new Set<string>(),
  reloaded: undefined as any,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...a: any[]) => unknown) => (...args: unknown[]) => fn({ user_id: 'u1' }, { tenant: 't1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async (_u: unknown, r: string, a: string) => m.perms.has(`${r}:${a}`) }));
vi.mock('@alga-psa/authorization/ticketRecordAuthorization', () => ({ authorizeTicketRecordAccess: m.record }));
vi.mock('@alga-psa/db', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('../lib/rma/warrantyTransitions', async (orig) => ({ ...(await orig<Record<string, unknown>>()), openWarrantyClaimCore: m.core }));
vi.mock('../lib/rma/warrantyRunner', async (orig) => ({ ...(await orig<Record<string, unknown>>()), assetGate: async () => async () => undefined }));
vi.mock('../lib/rma/publishRmaUpdated', () => ({ publishWarrantyClaimOpened: vi.fn(), publishRmaUpdated: vi.fn() }));
vi.mock('../lib/rmaCaseQuery', () => ({ rmaCaseQuery: () => ({ andWhere: () => ({ first: async () => m.reloaded }) }) }));

import { openWarrantyClaim } from './rmaWarrantyActions';
import { openWarrantyClaimFlow, openWarrantyClaimForTicketSchema, WarrantyError } from '../lib/rma';

const ASSET = '22222222-2222-4222-8222-222222222222';
const TICKET = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  m.core.mockReset(); m.record.mockReset(); m.record.mockResolvedValue({});
  m.perms = new Set(['warranty:create', 'asset:update', 'ticket:read']);
  m.reloaded = undefined;
});

describe('openWarrantyClaim (browser-facing)', () => {
  it('never hands a caller-supplied ticket_id to the core', async () => {
    m.core.mockResolvedValue({ rma: { rma_id: 'r1', ticket_id: null }, serialNumber: null });
    await openWarrantyClaim({ asset_id: ASSET, reason: 'x', ticket_id: TICKET });
    expect(m.core).toHaveBeenCalledTimes(1);
    const passed = m.core.mock.calls[0][3];
    expect(passed).not.toHaveProperty('ticket_id');
    expect(typeof m.core.mock.calls[0][4].authorizeTicket).toBe('function');
  });

  it('gives the core a real authorizer: ticket:read plus the per-record check, failing closed', async () => {
    m.core.mockImplementation(async (_trx, _t, _a, _i, options) => { await options.authorizeTicket({}, TICKET, 'read'); return { rma: { rma_id: 'r1' } }; });
    await openWarrantyClaim({ asset_id: ASSET, reason: 'x' });
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ ticketId: TICKET, tenant: 't1', action: 'read' }));

    m.record.mockClear();
    m.perms.delete('ticket:read');
    await expect(m.core.mock.calls.at(-1)![4].authorizeTicket({}, TICKET, 'read')).rejects.toThrow('Permission denied');
    expect(m.record).not.toHaveBeenCalled();
    m.perms.add('ticket:read');
    m.record.mockRejectedValue(new Error('Permission denied: Cannot access ticket'));
    await expect(m.core.mock.calls.at(-1)![4].authorizeTicket({}, TICKET, 'read')).rejects.toThrow('Permission denied');
  });

  it('success: returns the reloaded row with its ticket fields', async () => {
    m.core.mockResolvedValue({ rma: { rma_id: 'r1', ticket_id: TICKET }, serialNumber: 'SN' });
    m.reloaded = { rma_id: 'r1', ticket_id: TICKET, ticket_number: 'T-100' };
    expect(await openWarrantyClaim({ asset_id: ASSET, reason: 'x' })).toEqual(m.reloaded);
  });

  it('a core ticket refusal comes back as a value with the not-found key', async () => {
    m.core.mockRejectedValue(new WarrantyError('ticket_not_found', 'Ticket not found.'));
    expect(await openWarrantyClaim({ asset_id: ASSET, reason: 'x' })).toEqual({
      actionError: 'Ticket not found.', messageKey: 'features/inventory:errors.rma.ticketNotFound',
    });
  });
});

describe('openWarrantyClaimFlow with the ticket-aware schema (what openWarrantyClaimFromTicket uses)', () => {
  it('passes the supplied ticket_id and the injected authorizer to the core', async () => {
    m.core.mockResolvedValue({ rma: { rma_id: 'r1', ticket_id: TICKET }, serialNumber: null });
    m.reloaded = { rma_id: 'r1', ticket_id: TICKET, ticket_number: 'T-100' };
    const authorizeTicket = vi.fn(async () => undefined);
    const result = await openWarrantyClaimFlow({ user_id: 'u1' }, 't1', { asset_id: ASSET, reason: 'x', ticket_id: TICKET }, openWarrantyClaimForTicketSchema, authorizeTicket);
    expect(m.core.mock.calls[0][3]).toMatchObject({ ticket_id: TICKET });
    expect(m.core.mock.calls[0][4].authorizeTicket).toBe(authorizeTicket);
    expect(result).toEqual(m.reloaded);
  });
});
