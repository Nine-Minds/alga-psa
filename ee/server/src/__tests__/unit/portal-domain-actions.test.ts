import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PortalDomain } from 'server/src/models/PortalDomainModel';

type MockWorkflowResult = { enqueued: boolean };

type PortalDomainState = PortalDomain;

const baseRecord: PortalDomainState = {
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

let portalDomainStore: PortalDomainState = { ...baseRecord };

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

vi.mock('@/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'user-1' })),
}));

vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@ee/lib/portal-domains/workflowClient', () => ({
  enqueuePortalDomainWorkflow: vi.fn((args) => enqueueWorkflow(args)),
}));

vi.mock('@alga-psa/shared/core/secretProvider', () => ({
  secretProvider: {
    getSecret: vi.fn(async () => null),
  },
}));

vi.mock('@alga-psa/shared/core', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/shared/core/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('server/src/models/PortalDomainModel', async () => {
  const actual = await vi.importActual<typeof import('server/src/models/PortalDomainModel')>('server/src/models/PortalDomainModel');

  return {
    ...actual,
    computeCanonicalHost: vi.fn(() => 'tenant123.portal.algapsa.com'),
    getPortalDomain: vi.fn(async () => ({ ...portalDomainStore })),
    upsertPortalDomain: vi.fn(async (_knex: any, _tenant: string, input: any) => {
      portalDomainStore = {
        ...portalDomainStore,
        domain: input.domain,
        status: input.status,
        statusMessage: input.statusMessage,
        verificationDetails: input.verificationDetails,
        certificateSecretName: input.certificateSecretName,
        lastSyncedResourceVersion: input.lastSyncedResourceVersion,
        updatedAt: new Date(),
        lastCheckedAt: input.lastCheckedAt ? new Date(input.lastCheckedAt) : new Date(),
      } satisfies PortalDomainState;
      return { ...portalDomainStore };
    }),
    updatePortalDomain: vi.fn(async (_knex: any, _tenant: string, patch: any) => {
      const next: PortalDomainState = {
        ...portalDomainStore,
        ...patch,
        lastCheckedAt: patch.lastCheckedAt
          ? new Date(patch.lastCheckedAt)
          : portalDomainStore.lastCheckedAt,
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
