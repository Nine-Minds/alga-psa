// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  currentUser: null as any,
  tenant: 'tenant-1',
  rows: {} as Record<string, any>,
  permission: vi.fn(),
  createTenantKnex: vi.fn(),
  authorizeTicket: vi.fn(),
  mutations: [] as string[],
  TicketRecordAccessDeniedError: class extends Error {
    constructor() {
      super('Permission denied: Cannot access ticket');
      this.name = 'TicketRecordAccessDeniedError';
    }
  },
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(h.currentUser, { tenant: h.tenant }, ...args),
  hasPermission: (...args: any[]) => h.permission(...args),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => h.createTenantKnex(...args),
  withTransaction: async (_knex: unknown, callback: (trx: unknown) => unknown) => callback({}),
  tenantDb: () => ({
    table: (table: string) => {
      const builder: any = {
        where: () => builder,
        forShare: () => builder,
        forUpdate: () => builder,
        first: async () => h.rows[table],
        delete: async () => { h.mutations.push(`delete:${table}`); return 1; },
        update: async () => { h.mutations.push(`update:${table}`); return 1; },
        insert: () => { h.mutations.push(`insert:${table}`); return { returning: async () => [{}] }; },
      };
      return builder;
    },
    tenantJoin: (query: unknown) => query,
  }),
}));
vi.mock('@alga-psa/authorization/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccess: (...args: any[]) => h.authorizeTicket(...args),
  TicketRecordAccessDeniedError: h.TicketRecordAccessDeniedError,
}));

import {
  addTicketFixedFeeService,
  deleteTicketFixedFeeService,
  listTicketFixedFeeServices,
  updateTicketFixedFeeService,
} from './ticketFixedFeeActions';

const ticketId = '11111111-1111-4111-8111-111111111111';
const entryId = '22222222-2222-4222-8222-222222222222';
const serviceId = '33333333-3333-4333-8333-333333333333';
const addInput = { ticket_id: ticketId, service_id: serviceId, quantity: 1, currency_code: 'USD' };

beforeEach(() => {
  h.currentUser = { user_id: 'user-1', user_type: 'internal', tenant: h.tenant };
  h.rows = {
    tickets: { client_id: 'client-1' },
    ticket_fixed_fee_services: { ticket_id: ticketId, is_billed: false, rate: 100 },
    service_catalog: { service_id: serviceId },
    service_prices: { rate: 100 },
  };
  h.mutations = [];
  h.permission.mockReset().mockResolvedValue(true);
  h.createTenantKnex.mockReset().mockResolvedValue({ knex: {} });
  h.authorizeTicket.mockReset().mockResolvedValue({ ticket_id: ticketId });
});

describe('ticket fixed-fee action authorization', () => {
  it('denies client principals on every fixed-fee action before any lookup', async () => {
    h.currentUser = { ...h.currentUser, user_type: 'client' };
    const results = [
      await listTicketFixedFeeServices(ticketId),
      await addTicketFixedFeeService(addInput),
      await deleteTicketFixedFeeService(entryId),
      await updateTicketFixedFeeService(entryId, { quantity: 1, description: '' }),
    ];
    for (const result of results) {
      expect(result).toHaveProperty('permissionError', 'Permission denied: MSP ticket access required');
    }
    expect(h.permission).not.toHaveBeenCalled();
    expect(h.createTenantKnex).not.toHaveBeenCalled();
  });

  it('returns an actionable error instead of throwing for malformed ids', async () => {
    expect(await listTicketFixedFeeServices('not-a-uuid')).toHaveProperty('messageKey', 'features/tickets:fixedFeeServices.errors.ticketMissing');
    expect(await deleteTicketFixedFeeService('not-a-uuid')).toHaveProperty('messageKey', 'features/tickets:fixedFeeServices.errors.cannotDelete');
    expect(h.createTenantKnex).not.toHaveBeenCalled();
  });

  it('reports an inaccessible ticket exactly like a missing one when adding', async () => {
    h.rows.tickets = undefined;
    const missing = await addTicketFixedFeeService(addInput);
    h.rows.tickets = { client_id: 'client-1' };
    h.authorizeTicket.mockRejectedValue(new h.TicketRecordAccessDeniedError());
    const hidden = await addTicketFixedFeeService(addInput);
    expect(hidden).toEqual(missing);
    expect(hidden).toHaveProperty('messageKey', 'features/tickets:fixedFeeServices.errors.ticketMissing');
    expect(h.mutations).toEqual([]);
  });

  it('reports an entry on an inaccessible ticket exactly like a missing entry', async () => {
    h.rows.ticket_fixed_fee_services = undefined;
    const missingDelete = await deleteTicketFixedFeeService(entryId);
    const missingUpdate = await updateTicketFixedFeeService(entryId, { quantity: 2, description: '' });
    h.rows.ticket_fixed_fee_services = { ticket_id: ticketId, is_billed: false, rate: 100 };
    h.authorizeTicket.mockRejectedValue(new h.TicketRecordAccessDeniedError());
    expect(await deleteTicketFixedFeeService(entryId)).toEqual(missingDelete);
    expect(await updateTicketFixedFeeService(entryId, { quantity: 2, description: '' })).toEqual(missingUpdate);
    expect(h.mutations).toEqual([]);
  });

  it('still mutates when the MSP user can access the ticket', async () => {
    await expect(deleteTicketFixedFeeService(entryId)).resolves.toBeUndefined();
    await expect(updateTicketFixedFeeService(entryId, { quantity: 2, description: '' })).resolves.toBeUndefined();
    expect(h.mutations).toEqual(['delete:ticket_fixed_fee_services', 'update:ticket_fixed_fee_services']);
  });
});
