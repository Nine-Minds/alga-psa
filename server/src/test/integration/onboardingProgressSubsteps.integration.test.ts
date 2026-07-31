import { describe, it, expect, vi, beforeEach } from 'vitest';

// getOnboardingProgressAction lives in @alga-psa/onboarding and reads through
// @alga-psa/db (getConnection + tenantDb), @alga-psa/tenancy/server, and the
// @enterprise stubs — mock those seams (the pre-modularization server/src and
// @ee seams no longer intercept anything).
const dbState = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
}));

vi.mock('server/src/lib/db', () => ({
  // Consumed synchronously by the setup.ts @alga-psa/auth mock when resolving
  // the withAuth tenant.
  getCurrentTenantId: () => 'tenant_1',
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  getConnection: (...args: unknown[]) => dbState.getConnectionMock(...args),
  tenantDb: (knex: any, _tenant: string) => ({
    table: (table: string) => knex(table),
  }),
  createTenantKnex: async () => ({
    knex: await dbState.getConnectionMock('tenant_1'),
    tenant: 'tenant_1',
  }),
  runWithTenant: async (_tenant: string, cb: () => Promise<unknown>) => cb(),
}));

vi.mock('@alga-psa/tenancy/server', () => ({
  getPortalDomainStatusForTenant: vi.fn().mockResolvedValue({
    domain: 'portal.example.com',
    status: 'active',
    statusMessage: null,
    canonicalHost: 'tenant.portal.example.com',
    updatedAt: '2026-01-02T00:00:00.000Z',
    lastCheckedAt: null,
  }),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn().mockResolvedValue((_table: string) => {
    const qb: any = {
      where: vi.fn().mockReturnThis(),
      count: vi.fn().mockReturnThis(),
      max: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ total: 1, latest_updated: '2026-01-01T00:00:00.000Z' }),
    };
    return qb;
  }),
}));

vi.mock('@enterprise/lib/auth/providerConfig', () => ({
  getSsoProviderOptions: vi.fn().mockResolvedValue([{ id: 'google', configured: true }]),
}));

vi.mock('@enterprise/lib/actions/email-actions/managedDomainActions', () => ({
  getManagedEmailDomains: vi.fn().mockResolvedValue([
    { domain: 'example.com', status: 'verified', updatedAt: '2026-01-03T00:00:00.000Z' },
  ]),
}));

describe('getOnboardingProgressAction (substeps)', () => {
  beforeEach(() => {
    const knex = vi.fn((table: string) => {
      const builder: any = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnThis(),
        max: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        first: vi.fn().mockImplementation(async () => {
          if (table === 'tenant_settings') {
            return {
              settings: { clientPortal: { enabled: true } },
              updated_at: '2026-01-05T00:00:00.000Z',
              created_at: '2026-01-04T00:00:00.000Z',
            };
          }
          if (table === 'portal_invitations') {
            return { total: 1, latest_created: '2026-01-06T00:00:00.000Z' };
          }
          if (table === 'email_providers') {
            return { total: 1, latest_updated: '2026-01-07T00:00:00.000Z' };
          }
          return null;
        }),
        // calendar_providers is awaited as a list query.
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve([]).then(resolve, reject),
      };
      return builder;
    });

    dbState.getConnectionMock.mockReset();
    dbState.getConnectionMock.mockResolvedValue(knex);
  });

  it('returns portal + email steps with substeps', async () => {
    const { getOnboardingProgressAction } = await import('@alga-psa/onboarding/actions');
    const result = await getOnboardingProgressAction();

    const portal = result.steps.find((step) => step.id === 'client_portal_domain');
    expect(portal).toBeTruthy();
    expect(portal?.substeps?.map((s) => s.id)).toEqual([
      'portal_custom_domain',
      'portal_branding',
      'portal_invite_first_contact',
    ]);
    expect(portal?.status).toBe('complete');

    const email = result.steps.find((step) => step.id === 'managed_email');
    expect(email).toBeTruthy();
    expect(email?.substeps?.map((s) => s.id)).toEqual([
      'email_inbound_provider',
      'email_outbound_custom_domain',
    ]);
    expect(email?.status).toBe('complete');
  });
});
