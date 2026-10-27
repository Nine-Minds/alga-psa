import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateTicketInput } from '@shared/models/ticketModel';

/**
 * alga-2026-0002785 (customer ask via ticket 2592): POST /api/v1/tickets takes
 * `asset_ids` and links the devices in the SAME transaction as the insert, so a
 * refused link never leaves an orphaned ticket. Exactly one device also inherits
 * its billing profile, the way the from-asset dialog does; several devices are
 * ambiguous, so `billing_profile_id` is left to the normal client default.
 */
const h = vi.hoisted(() => {
  const tenant = '22222222-2222-4222-8222-222222222222';
  const ticketId = '11111111-1111-4111-8111-111111111111';
  const clientId = '33333333-3333-4333-8333-333333333333';
  const reloadedTicket: Record<string, unknown> = {
    ticket_id: ticketId,
    ticket_number: 'TIC-2785',
    title: 'Reception PC is dead',
    client_id: clientId,
    board_id: '44444444-4444-4444-8444-444444444444',
    status_id: '55555555-5555-4555-8555-555555555555',
    priority_id: '66666666-6666-4666-8666-666666666666',
    entered_at: '2026-10-27T12:00:00.000Z',
  };

  // Asset ids that exist in this tenant; anything else must be rejected.
  const knownAssets = new Set<string>();
  const assetLinks: Array<{ trx: unknown; rows: Record<string, unknown>[] }> = [];
  const fakeTrx = { name: 'the-one-transaction' };

  function builderFor(table: string) {
    const state: { ids: string[] } = { ids: [] };
    const builder: Record<string, unknown> = {
      where: vi.fn(() => builder),
      whereIn: vi.fn((_col: string, values: string[]) => {
        state.ids = values;
        return builder;
      }),
      pluck: vi.fn(async () => state.ids.filter((id) => knownAssets.has(id))),
      first: vi.fn(async () => (table === 'tickets' ? reloadedTicket : undefined)),
      insert: vi.fn(async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        if (table === 'asset_associations') {
          assetLinks.push({ trx: lastTrx, rows: Array.isArray(rows) ? rows : [rows] });
        }
        return undefined;
      }),
    };
    return builder;
  }

  let lastTrx: unknown = null;
  const tenantDbFor = (trx: unknown) => {
    lastTrx = trx;
    return { table: (table: string) => builderFor(table.split(' as ')[0]) };
  };

  return {
    tenant,
    ticketId,
    clientId,
    reloadedTicket,
    knownAssets,
    assetLinks,
    fakeTrx,
    tenantDbFor,
    trxUsed: () => lastTrx,
  };
});

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    withTransaction: (async (_knex: unknown, cb: (trx: unknown) => unknown) => cb(h.fakeTrx)) as any,
    tenantDb: ((conn: unknown) => h.tenantDbFor(conn)) as any,
  };
});

vi.mock('@alga-psa/tickets/actions/externalLinks/externalLinkPersistence', () => ({
  persistExternalLinksForCreate: vi.fn(async () => []),
  publishExternalLinkEvent: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/shared/lib/ticketActivity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/lib/ticketActivity')>();
  return { ...actual, writeTicketActivity: vi.fn(async () => undefined) };
});

const resolveBillingProfile = vi.hoisted(() => vi.fn(async () => 'bp-from-the-asset'));
vi.mock('@alga-psa/shared/models/assetBillingProfileModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/models/assetBillingProfileModel')>();
  return { ...actual, resolveAssetBillingProfileIdForClient: resolveBillingProfile };
});

import { TicketService } from '../../../lib/api/services/TicketService';
import { TicketModel } from '@shared/models/ticketModel';
import { ValidationError } from '../../../lib/api/middleware/apiMiddleware';

const ASSET_A = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ASSET_B = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const context = { tenant: h.tenant, userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } as any;

function baseRequest(assetIds?: string[]) {
  return {
    title: 'Reception PC is dead',
    client_id: h.clientId,
    board_id: h.reloadedTicket.board_id,
    status_id: h.reloadedTicket.status_id,
    priority_id: h.reloadedTicket.priority_id,
    ...(assetIds ? { asset_ids: assetIds } : {}),
  } as any;
}

function newService() {
  const service = new TicketService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
  vi.spyOn(service as any, 'safePublishEvent').mockResolvedValue(undefined);
  return service;
}

describe('TicketService.create links the named assets', () => {
  let createSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    resolveBillingProfile.mockClear();
    resolveBillingProfile.mockResolvedValue('bp-from-the-asset');
    h.assetLinks.length = 0;
    h.knownAssets.clear();
    h.knownAssets.add(ASSET_A);
    h.knownAssets.add(ASSET_B);
    vi.spyOn(TicketModel, 'validateStatusBelongsToBoard').mockResolvedValue({ valid: true } as any);
    createSpy = vi
      .spyOn(TicketModel, 'createTicketWithRetry')
      .mockResolvedValue({ ticket_id: h.ticketId } as any);
  });

  it('writes one asset_associations row per device, on the ticket transaction', async () => {
    await newService().create(baseRequest([ASSET_A, ASSET_B]), context);

    expect(h.assetLinks).toHaveLength(1);
    const [batch] = h.assetLinks;
    expect(batch.rows.map((row) => row.asset_id)).toEqual([ASSET_A, ASSET_B]);
    expect(batch.rows.every((row) => row.entity_id === h.ticketId)).toBe(true);
    expect(batch.rows.every((row) => row.entity_type === 'ticket')).toBe(true);
    expect(batch.rows.every((row) => row.tenant === h.tenant)).toBe(true);
    expect(batch.rows.every((row) => row.created_by === context.userId)).toBe(true);
    // The link must ride the same handle the insert did — the whole point is
    // that a failed link rolls the ticket back.
    expect(batch.trx).toBe(h.fakeTrx);
  });

  it('inherits the billing profile from a single asset', async () => {
    await newService().create(baseRequest([ASSET_A]), context);

    expect(resolveBillingProfile).toHaveBeenCalledWith(h.fakeTrx, h.tenant, ASSET_A, h.clientId);
    const forwarded = createSpy.mock.calls[0][0] as CreateTicketInput;
    expect(forwarded.billing_profile_id).toBe('bp-from-the-asset');
  });

  it('leaves the billing profile to the client default with several assets', async () => {
    await newService().create(baseRequest([ASSET_A, ASSET_B]), context);

    // Nothing to inherit unambiguously, so the resolver is never consulted.
    expect(resolveBillingProfile).not.toHaveBeenCalled();
    const forwarded = createSpy.mock.calls[0][0] as CreateTicketInput;
    expect(forwarded.billing_profile_id).toBeUndefined();
  });

  it('does not consult the resolver when no asset is named', async () => {
    await newService().create(baseRequest(), context);

    expect(resolveBillingProfile).not.toHaveBeenCalled();
    expect(h.assetLinks).toHaveLength(0);
    const forwarded = createSpy.mock.calls[0][0] as CreateTicketInput;
    expect(forwarded.billing_profile_id).toBeUndefined();
  });

  it('rejects an asset from outside the tenant before any ticket is written', async () => {
    const stranger = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

    await expect(newService().create(baseRequest([ASSET_A, stranger]), context))
      .rejects.toBeInstanceOf(ValidationError);

    // No insert, no link: the ticket never existed, so nothing is orphaned.
    expect(createSpy).not.toHaveBeenCalled();
    expect(h.assetLinks).toHaveLength(0);
  });

  it('ignores blanks and repeats so one device is linked once', async () => {
    await newService().create(baseRequest([ASSET_A, ASSET_A, '']), context);

    expect(h.assetLinks[0].rows.map((row) => row.asset_id)).toEqual([ASSET_A]);
    // De-duplicated to one device, so the billing rule still applies.
    expect(resolveBillingProfile).toHaveBeenCalledTimes(1);
  });
});
