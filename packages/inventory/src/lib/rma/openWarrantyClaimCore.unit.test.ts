/**
 * alga-2026-0002941: opening a warranty claim must authorize the ticket it finally links, whether the id was supplied
 * or derived from the asset's open custody episode. A denied ticket reads exactly like a missing one and writes nothing.
 * The transaction is faked so the test sees every table the core touches and every insert it attempts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

const fake = vi.hoisted(() => ({
  asset: null as any,
  custody: null as any,
  inserts: [] as Array<{ table: string; row: any }>,
  tables: [] as string[],
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      fake.tables.push(name);
      const chain: any = {
        where: () => chain,
        whereNull: () => chain,
        select: () => chain,
        first: async () => (name === 'assets' ? fake.asset : name === 'asset_custody' ? fake.custody : undefined),
        insert: (row: any) => {
          fake.inserts.push({ table: name, row });
          return { returning: async () => [{ ...row, rma_id: 'rma-new' }] };
        },
      };
      return chain;
    },
  }),
}));
vi.mock('@alga-psa/shared/services/numberingService', () => ({ SharedNumberingService: { getNextNumber: async () => 'RMA-00001' } }));
vi.mock('./recordRmaEvent', () => ({ recordRmaEvent: async (_t: unknown, _tenant: string, e: any) => ({ event_id: 'ev', ...e }) }));
vi.mock('@alga-psa/assets/lib/custody/recordCustodyEvent', () => ({ recordCustodyEvent: vi.fn() }));
vi.mock('@alga-psa/assets/lib/custody/closeCustodyEpisode', () => ({ closeCustodyEpisode: vi.fn() }));
vi.mock('@alga-psa/assets/lib/custody/shared', () => ({ loadCustody: vi.fn() }));
vi.mock('@alga-psa/assets/lib/warranty/applyWarrantyReplacement', () => ({ applyWarrantyReplacement: vi.fn() }));

import { openWarrantyClaimCore } from './warrantyTransitions';
import { withWarrantyErrors } from './warrantyRunner';

const ASSET = '22222222-2222-4222-8222-222222222222';
const SUPPLIED_TICKET = '33333333-3333-4333-8333-333333333333';
const CUSTODY_TICKET = '44444444-4444-4444-8444-444444444444';
const trx = {} as Knex.Transaction;
const input = { asset_id: ASSET, reason: 'Dock drops displays', vendor_id: null, rma_reference: null, rma_type: 'standard' as const };
const rmaInserts = () => fake.inserts.filter((i) => i.table === 'rma_cases');

beforeEach(() => {
  fake.asset = { asset_id: ASSET, client_id: 'client-1', ownership: 'client', stock_unit_id: null, serial_number: 'SN1' };
  fake.custody = undefined;
  fake.inserts = [];
  fake.tables = [];
});

const open = (ticket_id: string | null, authorizeTicket: any) =>
  withWarrantyErrors(() => openWarrantyClaimCore(trx, 't1', 'u1', { ...input, ticket_id }, { authorizeTicket, authorizeAsset: async () => undefined }));

const NOT_FOUND = { actionError: 'Ticket not found.', messageKey: 'features/inventory:errors.rma.ticketNotFound' };

describe('openWarrantyClaimCore authorizes the final resolved ticket', () => {
  it('refuses a caller-supplied ticket the caller cannot access, as "not found", with no write and no ticket data', async () => {
    const authorizeTicket = vi.fn(async () => { throw new Error('Permission denied: Cannot access ticket'); });
    const result = await open(SUPPLIED_TICKET, authorizeTicket);
    expect(authorizeTicket).toHaveBeenCalledWith(trx, SUPPLIED_TICKET, 'read');
    expect(result).toEqual(NOT_FOUND);
    expect(JSON.stringify(result)).not.toContain(SUPPLIED_TICKET);
    expect(fake.inserts).toEqual([]);
  });

  it('refuses a ticket derived from open custody the caller cannot access, same shape, no write, no custody ticket id', async () => {
    fake.custody = { custody_id: 'cust-1', ticket_id: CUSTODY_TICKET };
    const authorizeTicket = vi.fn(async () => { throw new Error('Permission denied: Cannot access ticket'); });
    const result = await open(null, authorizeTicket);
    expect(authorizeTicket).toHaveBeenCalledWith(trx, CUSTODY_TICKET, 'read');
    expect(result).toEqual(NOT_FOUND);
    expect(JSON.stringify(result)).not.toContain(CUSTODY_TICKET);
    expect(fake.inserts).toEqual([]);
  });

  it('authorizes only the ticket it will store: custody wins over a supplied id, so the supplied one is never linked', async () => {
    fake.custody = { custody_id: 'cust-1', ticket_id: CUSTODY_TICKET };
    const authorizeTicket = vi.fn(async () => undefined);
    await open(SUPPLIED_TICKET, authorizeTicket);
    expect(authorizeTicket).toHaveBeenCalledTimes(1);
    expect(authorizeTicket).toHaveBeenCalledWith(trx, CUSTODY_TICKET, 'read');
    expect(rmaInserts()[0].row.ticket_id).toBe(CUSTODY_TICKET);
  });

  it('a missing ticket (the authorizer says "Ticket not found") and a denied one are indistinguishable', async () => {
    const missing = await open(SUPPLIED_TICKET, async () => { throw new Error('Ticket not found'); });
    const denied = await open(SUPPLIED_TICKET, async () => { throw new Error('Permission denied: Cannot access ticket'); });
    expect(missing).toEqual(denied);
    expect(denied).toEqual(NOT_FOUND);
  });

  it('throws a WarrantyError, so the transaction rolls back', async () => {
    await expect(
      openWarrantyClaimCore(trx, 't1', 'u1', { ...input, ticket_id: SUPPLIED_TICKET }, { authorizeTicket: async () => { throw new Error('no'); } })
    ).rejects.toMatchObject({ name: 'WarrantyError', code: 'ticket_not_found' });
    expect(fake.inserts).toEqual([]);
  });

  it('links an authorized ticket and records it on the event', async () => {
    const authorizeTicket = vi.fn(async () => undefined);
    const result: any = await open(SUPPLIED_TICKET, authorizeTicket);
    expect(result.rma.ticket_id).toBe(SUPPLIED_TICKET);
    expect(rmaInserts()).toHaveLength(1);
    expect(result.event.payload.ticket_id).toBe(SUPPLIED_TICKET);
  });

  it('does not call the authorizer when there is no ticket at all', async () => {
    const authorizeTicket = vi.fn(async () => undefined);
    const result: any = await open(null, authorizeTicket);
    expect(authorizeTicket).not.toHaveBeenCalled();
    expect(result.rma.ticket_id).toBeNull();
  });

  it('cannot be called without an authorizer (compile-time)', () => {
    const never = () => {
      // @ts-expect-error authorizeTicket is required: there is no default and no no-op
      void openWarrantyClaimCore(trx, 't1', 'u1', input, { authorizeAsset: async () => undefined });
      // @ts-expect-error the options argument itself is required
      void openWarrantyClaimCore(trx, 't1', 'u1', input);
    };
    expect(typeof never).toBe('function');
  });
});
