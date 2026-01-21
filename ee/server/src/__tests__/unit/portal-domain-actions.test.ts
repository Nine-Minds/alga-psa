import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PortalDomain } from 'server/src/models/PortalDomainModel';

type MockWorkflowResult = { enqueued: boolean };

const baseRecord: PortalDomain = {
  id: 'portal-domain-1',
  tenant: 'tenant-123',
  domain: 'current.example.com',
  canonicalHost: 'tenant123.portal.algapsa.com',
  status: 'active',
  statusMessage: 'Active',
  lastCheckedAt: new Date(),
  verificationMethod: 'cname',
  verificationDetails: {},
  certificateSecretName: 'portal-domain-tenant-123',
  lastSyncedResourceVersion: 'rv-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

let portalDomainStore: PortalDomain | null = { ...baseRecord };

const analyticsCapture = vi.fn();
const enqueueWorkflow = vi.fn(async (): Promise<MockWorkflowResult> => ({ enqueued: true }));

vi.mock('@/lib/analytics/posthog', () => ({
  analytics: {
    capture: analyticsCapture,
  },
}));

const knexStub: any = {
  fn: {
    now: () => new Date().toISOString(),
  },
};

vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexStub, tenant: 'tenant-123' })),
}));

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'user-1' })),
}));

vi.mock('@alga-psa/auth', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@ee/lib/portal-domains/workflowClient', () => ({
  enqueuePortalDomainWorkflow: vi.fn((args) => enqueueWorkflow(args)),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  secretProvider: {
    getSecret: vi.fn(async () => null),
  },
}));

vi.mock('@alga-psa/core', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/core/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('server/src/models/PortalDomainModel', async () => {
  const actual = await vi.importActual('server/src/models/PortalDomainModel') as typeof import('server/src/models/PortalDomainModel');

  return {
    ...actual,
    computeCanonicalHost: actual.computeCanonicalHost, // Use the real function to test NEXTAUTH_URL logic
    getPortalDomain: vi.fn(async () => (portalDomainStore ? { ...portalDomainStore } : null)),
    upsertPortalDomain: vi.fn(async (_knex: any, _tenant: string, input: any) => {
      const existing = portalDomainStore ?? {
        ...baseRecord,
        id: input.id ?? 'portal-domain-1',
        domain: input.domain,
      };
      portalDomainStore = {
        ...existing,
        domain: input.domain,
        status: input.status,
        statusMessage: input.statusMessage,
        verificationDetails: input.verificationDetails,
        certificateSecretName: input.certificateSecretName,
        lastSyncedResourceVersion: input.lastSyncedResourceVersion,
        updatedAt: new Date(),
        lastCheckedAt: input.lastCheckedAt ? new Date(input.lastCheckedAt) : new Date(),
      } satisfies PortalDomain;
      return { ...portalDomainStore };
    }),
    updatePortalDomain: vi.fn(async (_knex: any, _tenant: string, patch: any) => {
      const current = portalDomainStore ?? baseRecord;
      const next: PortalDomain = {
        ...current,
        ...patch,
        lastCheckedAt: patch.lastCheckedAt
          ? new Date(patch.lastCheckedAt)
          : current.lastCheckedAt,
        updatedAt: new Date(),
      };
      portalDomainStore = next;
      return { ...portalDomainStore };
    }),
    normalizeHostname: vi.fn((hostname: string) => hostname.trim().toLowerCase()),
  };
});

const { requestPortalDomainRegistrationAction } = await import('../../lib/actions/tenant-actions/portalDomainActions');

describe('requestPortalDomainRegistrationAction', () => {
  beforeEach(() => {
    portalDomainStore = { ...baseRecord };
    analyticsCapture.mockClear();
    enqueueWorkflow.mockClear();
  });

  it('enqueues register trigger when no prior domain exists', async () => {
    portalDomainStore = null;

    const result = await requestPortalDomainRegistrationAction({ domain: 'first.example.com' });

    expect(enqueueWorkflow).toHaveBeenCalledWith({
      tenantId: 'tenant-123',
      portalDomainId: 'portal-domain-1',
      trigger: 'register',
    });
    expect(result.status.domain).toBe('first.example.com');
    expect(result.status.status).toBe('pending_dns');
    expect(result.status.statusMessage).toContain('Waiting for DNS verification');
  });

  it('resets state and enqueues refresh when changing to a new domain', async () => {
    const result = await requestPortalDomainRegistrationAction({ domain: 'new.example.com' });

    expect(portalDomainStore.domain).toBe('new.example.com');
    expect(portalDomainStore.status).toBe('pending_dns');
    expect(portalDomainStore.certificateSecretName).toBeNull();
    expect(enqueueWorkflow).toHaveBeenCalledWith({
      tenantId: 'tenant-123',
      portalDomainId: portalDomainStore.id,
      trigger: 'refresh',
    });

    expect(analyticsCapture).toHaveBeenCalledWith('portal_domain.registration_enqueued', expect.objectContaining({
      tenant_id: 'tenant-123',
      domain: 'new.example.com',
      trigger: 'refresh',
      was_update: true,
    }));

    expect(result.status.domain).toBe('new.example.com');
    expect(result.status.status).toBe('pending_dns');
    expect(result.status.statusMessage).toContain('Updating custom domain');
  });

  it('keeps register trigger when domain remains the same', async () => {
    portalDomainStore = {
      ...portalDomainStore,
      domain: 'existing.example.com',
    };

    const result = await requestPortalDomainRegistrationAction({ domain: 'existing.example.com' });

    expect(enqueueWorkflow).toHaveBeenCalledWith({
      tenantId: 'tenant-123',
      portalDomainId: portalDomainStore.id,
      trigger: 'register',
    });

    expect(analyticsCapture).toHaveBeenCalledWith('portal_domain.registration_enqueued', expect.objectContaining({
      trigger: 'register',
      was_update: false,
    }));

    expect(result.status.statusMessage).toContain('Waiting for DNS verification');
  });
});

describe('portal domain canonical host with NEXTAUTH_URL', () => {
  beforeEach(() => {
    portalDomainStore = { ...baseRecord };
    analyticsCapture.mockClear();
    enqueueWorkflow.mockClear();
    // Clear any existing NEXTAUTH_URL for clean test state
    delete process.env.NEXTAUTH_URL;
  });

  it('uses domain from NEXTAUTH_URL for canonical host in staging environment', async () => {
    // Set staging environment NEXTAUTH_URL
    process.env.NEXTAUTH_URL = 'https://sebastian.9minds.ai';
    portalDomainStore = null; // No existing domain

    const result = await requestPortalDomainRegistrationAction({ domain: 'custom.example.com' });

    // Verify canonical host uses domain from NEXTAUTH_URL
    expect(result.status.canonicalHost).toBe('tenant-.portal.sebastian.9minds.ai');
    expect(result.status.verificationDetails.expected_cname).toBe('tenant-.portal.sebastian.9minds.ai');
  });

  it('uses domain from NEXTAUTH_URL for canonical host in production environment', async () => {
    // Set production environment NEXTAUTH_URL
    process.env.NEXTAUTH_URL = 'https://app.algapsa.com';
    portalDomainStore = null; // No existing domain

    const result = await requestPortalDomainRegistrationAction({ domain: 'custom.example.com' });

    // Verify canonical host uses domain from NEXTAUTH_URL
    expect(result.status.canonicalHost).toBe('tenant-.portal.app.algapsa.com');
    expect(result.status.verificationDetails.expected_cname).toBe('tenant-.portal.app.algapsa.com');
  });

  it('falls back to default domain when NEXTAUTH_URL is not set', async () => {
    // Ensure NEXTAUTH_URL is not set
    delete process.env.NEXTAUTH_URL;
    portalDomainStore = null; // No existing domain

    const result = await requestPortalDomainRegistrationAction({ domain: 'custom.example.com' });

    // Verify canonical host falls back to default
    expect(result.status.canonicalHost).toBe('tenant-.portal.algapsa.com');
    expect(result.status.verificationDetails.expected_cname).toBe('tenant-.portal.algapsa.com');
  });
});
