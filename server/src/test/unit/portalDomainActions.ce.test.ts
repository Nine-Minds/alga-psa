import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PortalDomain } from '@/models/PortalDomainModel';

/**
 * Community Edition behaviour of the portal-domain actions: the edition seam
 * provides no hosted driver, so the direct (trust-on-submit) driver is in
 * effect under every deployment profile, not only `appliance`.
 */

const baseRecord: PortalDomain = {
  id: 'portal-domain-1',
  tenant: 'tenant-123',
  domain: 'portal.acme.com',
  canonicalHost: 'tenant-.portal.alga.acme.com',
  status: 'active',
  statusMessage: 'Active',
  lastCheckedAt: new Date(),
  verificationMethod: 'cname',
  verificationDetails: { forward_host_header: true },
  certificateSecretName: null,
  lastSyncedResourceVersion: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

let portalDomainStore: PortalDomain | null = null;

const { upsertPortalDomain, deletePortalDomain, updatePortalDomain } = vi.hoisted(() => ({
  upsertPortalDomain: vi.fn(),
  deletePortalDomain: vi.fn(),
  updatePortalDomain: vi.fn(),
}));

// CE stub of the edition seam: no Temporal-backed driver ships.
vi.mock('@ee/lib/portal-domains/provisioner/hosted', () => ({ hostedProvisioner: null }));

vi.mock('@/lib/portal-domains/portalDomainSeen', () => ({
  getPortalDomainLastSeen: vi.fn(async () => null),
  clearPortalDomainSeen: vi.fn(async () => undefined),
  recordPortalDomainSeen: vi.fn(async () => undefined),
}));

vi.mock('@/lib/analytics/posthog', () => ({
  analytics: { capture: vi.fn() },
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-123' })),
}));

vi.mock('@alga-psa/auth', () => {
  const user = { user_id: 'user-1', tenant: 'tenant-123', user_type: 'internal' };
  return {
    withAuth: (handler: (...args: any[]) => any) =>
      (...args: any[]) => handler(user, { tenant: 'tenant-123' }, ...args),
    hasPermission: vi.fn(async () => true),
  };
});

vi.mock('@/models/PortalDomainModel', async () => {
  const actual = await vi.importActual('@/models/PortalDomainModel') as typeof import('@/models/PortalDomainModel');
  return {
    ...actual,
    getPortalDomain: vi.fn(async () => (portalDomainStore ? { ...portalDomainStore } : null)),
    upsertPortalDomain,
    updatePortalDomain,
    deletePortalDomain,
  };
});

const {
  getPortalDomainStatusAction,
  requestPortalDomainRegistrationAction,
  refreshPortalDomainStatusAction,
  retryPortalDomainRegistrationAction,
  disablePortalDomainAction,
} = await import('@/lib/actions/tenant-actions/portalDomainActions');
const { resolvePortalDomainProvisioning, directProvisioner } = await import('@/lib/portal-domains/provisioner');

const savedEnv = {
  DEPLOYMENT_PROFILE: process.env.DEPLOYMENT_PROFILE,
  EDITION: process.env.EDITION,
  NEXT_PUBLIC_EDITION: process.env.NEXT_PUBLIC_EDITION,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
};

function restore(key: keyof typeof savedEnv) {
  const value = savedEnv[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterAll(() => {
  (Object.keys(savedEnv) as Array<keyof typeof savedEnv>).forEach(restore);
});

beforeEach(() => {
  portalDomainStore = null;
  vi.clearAllMocks();
  delete process.env.EDITION;
  delete process.env.NEXT_PUBLIC_EDITION;
  delete process.env.NEXTAUTH_URL;
  upsertPortalDomain.mockImplementation(async (_knex: unknown, _tenant: string, input: any) => {
    portalDomainStore = { ...baseRecord, ...input, lastCheckedAt: new Date() };
    return { ...portalDomainStore };
  });
  deletePortalDomain.mockImplementation(async () => {
    portalDomainStore = null;
  });
});

describe.each([
  ['unset (hosted default)', undefined],
  ['appliance', 'appliance'],
])('CE with DEPLOYMENT_PROFILE %s', (_label, profile) => {
  beforeEach(() => {
    if (profile === undefined) {
      delete process.env.DEPLOYMENT_PROFILE;
    } else {
      process.env.DEPLOYMENT_PROFILE = profile;
    }
  });

  it('falls back to the direct driver because no hosted driver ships', () => {
    expect(resolvePortalDomainProvisioning()).toEqual({ mode: 'direct', provisioner: directProvisioner });
  });

  it('reports an editable direct-mode status while identifying as CE', async () => {
    const status = await getPortalDomainStatusAction();

    expect(status).toMatchObject({ isEditable: true, edition: 'ce', mode: 'direct', status: 'disabled' });
  });

  it('registers trust-on-submit: row goes active immediately', async () => {
    const result = await requestPortalDomainRegistrationAction({ domain: 'Portal.Acme.com' });

    expect(upsertPortalDomain).toHaveBeenCalledTimes(1);
    const input = upsertPortalDomain.mock.calls[0][2];
    expect(input.domain).toBe('portal.acme.com');
    expect(input.status).toBe('active');
    expect(input.verificationDetails.forward_host_header).toBe(true);

    if (!('status' in result)) {
      throw new Error(`Expected registration to succeed, got ${JSON.stringify(result)}`);
    }
    expect(result.status).toMatchObject({ domain: 'portal.acme.com', status: 'active', mode: 'direct', isEditable: true });
  });

  it("rejects the server's own primary host before touching the row", async () => {
    process.env.NEXTAUTH_URL = 'https://alga.acme.com';

    const result = await requestPortalDomainRegistrationAction({ domain: 'alga.acme.com' });

    expect(result).toMatchObject({ messageKey: 'msp/settings:errors.clientPortalDomain.notApplianceHost' });
    expect(upsertPortalDomain).not.toHaveBeenCalled();
  });

  it('refresh and retry return the stored status without rewriting the row', async () => {
    portalDomainStore = { ...baseRecord, status: 'dns_failed' };

    const retried = await retryPortalDomainRegistrationAction();
    expect(retried).toMatchObject({ domain: 'portal.acme.com', status: 'dns_failed', mode: 'direct' });

    const refreshed = await refreshPortalDomainStatusAction();
    expect(refreshed).toMatchObject({ domain: 'portal.acme.com', status: 'dns_failed', isEditable: true });

    expect(updatePortalDomain).not.toHaveBeenCalled();
    expect(upsertPortalDomain).not.toHaveBeenCalled();
  });

  it('disable deletes the row outright', async () => {
    portalDomainStore = { ...baseRecord };

    const status = await disablePortalDomainAction();

    expect(deletePortalDomain).toHaveBeenCalledWith({}, 'tenant-123');
    expect(status).toMatchObject({ domain: null, status: 'disabled', isEditable: true });
  });
});
