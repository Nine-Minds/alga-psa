import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({
  getCurrentTenantId: vi.fn().mockResolvedValue('tenant_1'),
}));

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(),
}));

vi.mock('@/lib/actions/tenant-actions/portalDomainActions', () => ({
  getPortalDomainStatusAction: vi.fn().mockResolvedValue({
    domain: 'portal.example.com',
    status: 'active',
    statusMessage: null,
    canonicalHost: 'tenant.portal.example.com',
    updatedAt: '2026-01-02T00:00:00.000Z',
    lastCheckedAt: null,
  }),
}));

vi.mock('@/lib/actions/import-actions/importActions', () => ({
  listImportJobs: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/actions/calendarActions', () => ({
  getCalendarProviders: vi.fn().mockResolvedValue({ success: true, providers: [] }),
}));

vi.mock('@shared/db/admin', () => ({
  getAdminConnection: vi.fn().mockResolvedValue(() => {
    const qb: any = {
      where: vi.fn().mockReturnThis(),
      count: vi.fn().mockReturnThis(),
      max: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ total: 1, latest_updated: '2026-01-01T00:00:00.000Z' }),
    };
    return qb;
  }),
}));

vi.mock('@ee/lib/auth/providerConfig', () => ({
  getSsoProviderOptions: vi.fn().mockResolvedValue([{ id: 'google', configured: true }]),
}));

vi.mock('@ee/lib/actions/email-actions/managedDomainActions', () => ({
  getManagedEmailDomains: vi.fn().mockResolvedValue([
    { domain: 'example.com', status: 'verified', updatedAt: '2026-01-03T00:00:00.000Z' },
  ]),
}));

describe('getOnboardingProgressAction (substeps)', () => {
  beforeEach(async () => {
    const dbModule = await import('@/lib/db/db');
    const getConnection = dbModule.getConnection as Mock;

    const knex = vi.fn((table: string) => {
      const builder: any = {
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnThis(),
        max: vi.fn().mockReturnThis(),
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
      };
      return builder;
    });

    getConnection.mockResolvedValue(knex);
  });

  it('returns portal + email steps with substeps', async () => {
    const { getOnboardingProgressAction } = await import('@/lib/actions/onboarding-progress');
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

