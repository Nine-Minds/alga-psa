import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Datto stores the raw alert as metadata, which names the site under
 * alertSourceInfo.siteUid rather than a top-level organizationId.
 */
const h = vi.hoisted(() => ({
  metadata: {} as Record<string, unknown>,
  orgWhere: [] as Array<Record<string, unknown>>,
  createTicket: vi.fn(async () => ({ ticket_id: 'ticket-1', ticket_number: 'T-1' })),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    tenantJoin: () => undefined,
    table: (name: string) => {
      const qb: any = {
        where: (w: Record<string, unknown>) => {
          if (name === 'rmm_organization_mappings') h.orgWhere.push(w);
          return qb;
        },
        andWhere: () => qb,
        update: async () => 1,
        first: async () => {
          if (name === 'rmm_alerts as a') {
            return {
              alert_id: 'alert-1',
              ticket_id: null,
              asset_id: null,
              integration_id: 'int-1',
              provider: 'datto',
              external_alert_id: 'ext-1',
              external_device_id: null,
              severity: 'major',
              triggered_at: '2026-01-01T00:00:00.000Z',
              metadata: h.metadata,
            };
          }
          if (name === 'rmm_organization_mappings') {
            return { client_id: 'client-1', external_organization_name: 'Site One', billing_profile_id: 'profile-1' };
          }
          return undefined;
        },
      };
      return qb;
    },
  }),
}));
vi.mock('../ticketCreator', () => ({ createTicketForAlert: (...a: unknown[]) => (h.createTicket as any)(...a) }));
vi.mock('../ticketCreatedEvent', () => ({ publishRmmTicketCreated: async () => undefined }));

import { createTicketForAlertId } from '../createTicketForAlertId';

const knex = { transaction: async (fn: (trx: unknown) => Promise<unknown>) => fn({}) } as any;

describe('createTicketForAlertId organization resolution', () => {
  beforeEach(() => {
    h.orgWhere = [];
    h.createTicket.mockClear();
  });

  it('falls back to alertSourceInfo.siteUid for a Datto alert', async () => {
    h.metadata = { alertUid: 'ext-1', alertSourceInfo: { siteUid: 'site-1' } };
    await createTicketForAlertId(knex, { tenantId: 't1', alertId: 'alert-1' });

    expect(h.orgWhere).toEqual([{ integration_id: 'int-1', external_organization_id: 'site-1' }]);
    expect(h.createTicket).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clientId: 'client-1', mappingBillingProfileId: 'profile-1' })
    );
  });

  it('still prefers a top-level organizationId', async () => {
    h.metadata = { organizationId: 'org-9', alertSourceInfo: { siteUid: 'site-1' } };
    await createTicketForAlertId(knex, { tenantId: 't1', alertId: 'alert-1' });
    expect(h.orgWhere[0]).toEqual({ integration_id: 'int-1', external_organization_id: 'org-9' });
  });

  it('errors when neither identifies an organization and the asset has no client', async () => {
    h.metadata = { alertSourceInfo: {} };
    await expect(createTicketForAlertId(knex, { tenantId: 't1', alertId: 'alert-1' })).rejects.toThrow(/No client resolvable/);
  });
});
