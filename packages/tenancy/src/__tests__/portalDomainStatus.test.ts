import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
  withOptionalAuth: (fn: unknown) => fn,
}));

const dbState = vi.hoisted(() => ({
  tenant: 'tenant-a' as string | null,
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async (tenantId?: string) => {
    const knex = (table: string) => {
      let filter: Record<string, unknown> | null = null;
      const builder = {
        where(condition: Record<string, unknown>) {
          filter = condition;
          return builder;
        },
        async first() {
          if (table !== 'portal_domains') return undefined;
          return dbState.rows.find((row) =>
            Object.entries(filter ?? {}).every(([key, value]) => row[key] === value)
          );
        },
      };
      return builder;
    };
    return { knex, tenant: tenantId ?? dbState.tenant };
  }),
}));

import { getPortalDomainStatusForTenant } from '../server/portalDomainStatus';

const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;

beforeEach(() => {
  dbState.tenant = 'tenant-a';
  dbState.rows = [];
  delete process.env.NEXTAUTH_URL;
});

afterEach(() => {
  if (ORIGINAL_NEXTAUTH_URL === undefined) {
    delete process.env.NEXTAUTH_URL;
  } else {
    process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
  }
});

describe('getPortalDomainStatusForTenant', () => {
  it('returns the disabled CE response with the expected CNAME when no domain is configured', async () => {
    const response = await getPortalDomainStatusForTenant('tenant-a');

    expect(response.domain).toBeNull();
    expect(response.status).toBe('disabled');
    expect(response.edition).toBe('ce');
    expect(response.isEditable).toBe(false);
    expect(response.canonicalHost).toBe('tenant-.portal.algapsa.com');
    expect(response.verificationDetails).toEqual({ expected_cname: 'tenant-.portal.algapsa.com' });
    expect(response.statusMessage).toMatch(/Enterprise/);
  });

  it('maps a tenant-scoped record into the status response with ISO timestamps', async () => {
    dbState.rows = [
      {
        id: 'pd-1',
        tenant: 'tenant-a',
        domain: 'portal.tenant-a.example',
        canonical_host: 'tenant-.portal.algapsa.com',
        status: 'active',
        status_message: 'live',
        last_checked_at: new Date('2026-02-03T04:05:06Z'),
        verification_method: 'cname',
        verification_details: { expected_cname: 'tenant-.portal.algapsa.com' },
        certificate_secret_name: 'cert-secret',
        last_synced_resource_version: '7',
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-02-01T00:00:00Z'),
      },
      // A second tenant's record that must never bleed into the response.
      {
        id: 'pd-2',
        tenant: 'tenant-b',
        domain: 'portal.tenant-b.example',
        canonical_host: 'other.portal.algapsa.com',
        status: 'dns_failed',
        status_message: 'broken',
        last_checked_at: null,
        verification_method: 'cname',
        verification_details: {},
        certificate_secret_name: null,
        last_synced_resource_version: null,
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      },
    ];

    const response = await getPortalDomainStatusForTenant('tenant-a');

    expect(response.domain).toBe('portal.tenant-a.example');
    expect(response.status).toBe('active');
    expect(response.statusMessage).toBe('live');
    expect(response.lastCheckedAt).toBe('2026-02-03T04:05:06.000Z');
    expect(response.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(response.certificateSecretName).toBe('cert-secret');
    expect(response.lastSyncedResourceVersion).toBe('7');
  });

  it('keeps non-empty stored verification details instead of regenerating them', async () => {
    dbState.rows = [
      {
        id: 'pd-1',
        tenant: 'tenant-a',
        domain: 'portal.tenant-a.example',
        canonical_host: 'tenant-.portal.algapsa.com',
        status: 'pending_dns',
        status_message: null,
        last_checked_at: null,
        verification_method: 'cname',
        verification_details: { expected_cname: 'custom.value.example', note: 'manual' },
        certificate_secret_name: null,
        last_synced_resource_version: null,
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      },
    ];

    const response = await getPortalDomainStatusForTenant('tenant-a');

    expect(response.verificationDetails).toEqual({
      expected_cname: 'custom.value.example',
      note: 'manual',
    });
  });

  it('throws when no tenant context can be resolved', async () => {
    dbState.tenant = null;

    await expect(getPortalDomainStatusForTenant(undefined as unknown as string)).rejects.toThrow(
      'Tenant context is required to read portal domain status'
    );
  });
});
