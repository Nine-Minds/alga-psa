import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

import type { PortalDomainActivityRecord } from '../../workflows/portal-domains/types.js';
import {
  __setCommandRunnerForTests,
  __setConnectionFactoryForTests,
  checkPortalDomainDeploymentStatus,
  renderPortalDomainResources,
} from '../portal-domain-activities.js';

const URI = 'https://msp.example.com/api/auth/callback/google';

function createRecord(overrides: Partial<PortalDomainActivityRecord> = {}): PortalDomainActivityRecord {
  return {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenant: 'tenant-123',
    domain: 'msp.example.com',
    canonical_host: 'tenant123.portal.algapsa.com',
    status: 'deploying',
    status_message: null,
    surface: 'client_portal',
    verification_details: {},
    certificate_secret_name: null,
    last_synced_resource_version: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('checkPortalDomainDeploymentStatus SSO redirect URI gate', () => {
  const originalEnv = { ...process.env };
  let row: PortalDomainActivityRecord;
  let updates: Array<Record<string, unknown>>;

  beforeEach(() => {
    process.env.PORTAL_DOMAIN_SERVICE_HOST = 'app.msp.svc.cluster.local';
    process.env.PORTAL_DOMAIN_GATEWAY_NAMESPACE = 'msp';
    process.env.PORTAL_DOMAIN_CERT_NAMESPACE = 'msp';
    updates = [];

    // Chainable query mock that honours where() criteria (object or column/value form, as
    // used by tenantDb), so tenant + row scoping is actually exercised.
    const knexFn: any = () => {
      const criteria: Record<string, unknown> = {};
      const matches = () =>
        Object.entries(criteria).every(([key, value]) => (row as any)[key.split('.').pop() as string] === value);
      const query: any = {
        where(arg: Record<string, unknown> | string, value?: unknown) {
          if (typeof arg === 'string') criteria[arg] = value;
          else Object.assign(criteria, arg);
          return query;
        },
        first: async () => (matches() ? row : undefined),
        update: async (values: Record<string, unknown>) => {
          if (!matches()) return 0;
          updates.push(values);
          row = { ...row, ...(values as any) };
          return 1;
        },
      };
      return query;
    };
    knexFn.fn = { now: () => 'now()' };
    __setConnectionFactoryForTests(() => Promise.resolve(knexFn as Knex));

    // Certificate is Ready; gateway and virtualservice exist.
    __setCommandRunnerForTests(async () => ({
      stdout: JSON.stringify({ status: { conditions: [{ type: 'Ready', status: 'True' }] } }),
      stderr: '',
    }));
  });

  afterEach(() => {
    __setCommandRunnerForTests(null);
    __setConnectionFactoryForTests(null);
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('activates a client_portal domain regardless of redirect URI state', async () => {
    row = createRecord({ surface: 'client_portal' });
    const result = await checkPortalDomainDeploymentStatus({ portalDomainId: row.id, tenantId: row.tenant });
    expect(result?.status).toBe('active');
    expect(updates.at(-1)?.status).toBe('active');
  });

  it.each(['msp', 'both'])('holds %s domains in pending_redirect_uri when URIs are unconfirmed', async (surface) => {
    row = createRecord({
      surface,
      verification_details: { sso_redirect_uris: { required: [URI], confirmed: [] } },
    });
    const result = await checkPortalDomainDeploymentStatus({ portalDomainId: row.id, tenantId: row.tenant });
    expect(result?.status).toBe('pending_redirect_uri');
    expect(result?.statusMessage).toContain(URI);
    expect(updates.at(-1)?.status).toBe('pending_redirect_uri');
  });

  it('says the state could not be confirmed when no redirect URI state exists', async () => {
    row = createRecord({ surface: 'msp', verification_details: {} });
    const result = await checkPortalDomainDeploymentStatus({ portalDomainId: row.id, tenantId: row.tenant });
    expect(result?.status).toBe('pending_redirect_uri');
    expect(result?.statusMessage).toContain('could not be confirmed');
  });

  it.each(['msp', 'both'])('activates %s domains once URIs are confirmed', async (surface) => {
    row = createRecord({
      surface,
      verification_details: { sso_redirect_uris: { required: [URI], confirmed: [URI], source: 'operator' } },
    });
    const result = await checkPortalDomainDeploymentStatus({ portalDomainId: row.id, tenantId: row.tenant });
    expect(result?.status).toBe('active');
  });

  it('does not regress a domain already in pending_redirect_uri', async () => {
    row = createRecord({ surface: 'msp', status: 'pending_redirect_uri', status_message: 'waiting' });
    const result = await checkPortalDomainDeploymentStatus({ portalDomainId: row.id, tenantId: row.tenant });
    expect(result).toEqual({ status: 'pending_redirect_uri', statusMessage: 'waiting' });
    expect(updates).toHaveLength(0);
  });

  it('routes all paths to the app service for msp and both surfaces', () => {
    const config = {
      certificateApiVersion: 'cert-manager.io/v1',
      certificateNamespace: 'msp',
      certificateIssuerName: 'issuer',
      certificateIssuerKind: 'ClusterIssuer',
      certificateIssuerGroup: 'cert-manager.io',
      gatewayNamespace: 'msp',
      gatewaySelector: { istio: 'ingressgateway' },
      gatewayHttpsPort: 443,
      virtualServiceNamespace: 'msp',
      serviceHost: 'app.msp.svc.cluster.local',
      servicePort: 3000,
      manifestOutputDirectory: null,
    };
    for (const surface of ['client_portal', 'msp', 'both']) {
      const manifests = renderPortalDomainResources(createRecord({ surface }), config);
      expect(manifests.virtualService.spec.http[0].match[0].uri).toEqual({ prefix: '/' });
    }
  });
  it('is tenant-scoped: a row id under another tenant is not visible', async () => {
    row = createRecord({ surface: 'msp', verification_details: {} });
    const result = await checkPortalDomainDeploymentStatus({ portalDomainId: row.id, tenantId: 'tenant-other' });
    expect(result).toBeNull();
    expect(updates).toHaveLength(0);
  });
});
