import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fns must be created via vi.hoisted so the (hoisted) vi.mock factories can reference them.
const { upsertPortalDomain, updatePortalDomain, deletePortalDomain, enqueuePortalDomainWorkflow, tenantSecrets, msSsoReady } = vi.hoisted(() => ({
  upsertPortalDomain: vi.fn(),
  updatePortalDomain: vi.fn(),
  deletePortalDomain: vi.fn(),
  enqueuePortalDomainWorkflow: vi.fn(),
  tenantSecrets: {} as Record<string, string>,
  msSsoReady: { value: false },
}));

// Tenant-configured SSO (tenant secrets + Microsoft msp_sso profile); empty unless a test sets it.
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: async (_tenant: string, key: string) => tenantSecrets[key] ?? null,
  }),
}));
vi.mock('@alga-psa/integrations/lib/microsoftConsumerProfileResolution', () => ({
  resolveMicrosoftConsumerProfileConfigReadOnly: async () => ({ status: msSsoReady.value ? 'ready' : 'not_configured' }),
}));

vi.mock('@/models/PortalDomainModel', () => ({
  upsertPortalDomain,
  updatePortalDomain,
  deletePortalDomain,
  isTerminalStatus: (s: string) => ['active', 'disabled', 'dns_failed', 'certificate_failed'].includes(s),
}));

vi.mock('@ee/lib/portal-domains/workflowClient', () => ({ enqueuePortalDomainWorkflow }));

import {
  getPortalDomainProvisioner,
  resolvePortalDomainProvisioning,
  directProvisioner,
} from '@/lib/portal-domains/provisioner';
import { temporalProvisioner } from '@ee/lib/portal-domains/provisioner/temporalProvisioner';

const fakeKnex = {} as any;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXTAUTH_URL;
  upsertPortalDomain.mockImplementation(async (_knex: unknown, _tenant: string, input: any) => ({ id: 'pd-1', ...input }));
  updatePortalDomain.mockImplementation(async (_knex: unknown, _tenant: string, _target: unknown, patch: any) => ({ id: 'pd-1', ...patch }));
  deletePortalDomain.mockResolvedValue(undefined);
  enqueuePortalDomainWorkflow.mockResolvedValue({ enqueued: true });
});

describe('getPortalDomainProvisioner (factory)', () => {
  it('returns the direct driver for the appliance profile', () => {
    expect(getPortalDomainProvisioner({ DEPLOYMENT_PROFILE: 'appliance' })).toBe(directProvisioner);
  });

  it('returns the hosted (temporal) driver by default / for hosted when the seam provides one', () => {
    expect(getPortalDomainProvisioner({})).toBe(temporalProvisioner);
    expect(getPortalDomainProvisioner({ DEPLOYMENT_PROFILE: 'hosted' })).toBe(temporalProvisioner);
    expect(getPortalDomainProvisioner({ DEPLOYMENT_PROFILE: 'whatever' })).toBe(temporalProvisioner);
  });

  it('reports the mode that matches the selected driver', () => {
    expect(resolvePortalDomainProvisioning({})).toEqual({ mode: 'temporal', provisioner: temporalProvisioner });
    expect(resolvePortalDomainProvisioning({ DEPLOYMENT_PROFILE: 'appliance' })).toEqual({
      mode: 'direct',
      provisioner: directProvisioner,
    });
  });
});

describe('directProvisioner (appliance, trust-on-submit)', () => {
  it('register marks the row active with proxy verification details and enqueues nothing', async () => {
    const result = await directProvisioner.register({
      knex: fakeKnex,
      tenant: 't1',
      canonicalHost: 'abc1234.portal.alga.acme.com',
      domain: 'portal.acme.com',
      existing: null,
      domainChanged: false,
      surface: 'client_portal',
    });

    expect(result.enqueued).toBe(false);
    expect(enqueuePortalDomainWorkflow).not.toHaveBeenCalled();
    expect(upsertPortalDomain).toHaveBeenCalledTimes(1);
    const input = upsertPortalDomain.mock.calls[0][2];
    expect(input.status).toBe('active');
    expect(input.verificationDetails.forward_host_header).toBe(true);
    expect(input.verificationDetails.proxy_target_port).toBe(3000);
  });

  it('register rejects a domain equal to the NEXTAUTH_URL host and writes no row', async () => {
    process.env.NEXTAUTH_URL = 'https://alga.acme.com';
    await expect(
      directProvisioner.register({
        knex: fakeKnex,
        tenant: 't1',
        canonicalHost: 'abc1234.portal.alga.acme.com',
        domain: 'alga.acme.com',
        existing: null,
        domainChanged: false,
        surface: 'client_portal',
      })
    ).rejects.toThrow(/primary host/i);
    expect(upsertPortalDomain).not.toHaveBeenCalled();
  });

  it('disable deletes the row (OTTs cascade) and enqueues nothing', async () => {
    await directProvisioner.disable({ knex: fakeKnex, tenant: 't1', existing: { id: 'pd-1' } as any });
    expect(deletePortalDomain).toHaveBeenCalledWith(fakeKnex, 't1', { id: 'pd-1' });
    expect(enqueuePortalDomainWorkflow).not.toHaveBeenCalled();
  });

  it('refresh and retry are no-ops (no async provisioning to drive)', async () => {
    await directProvisioner.refresh({ knex: fakeKnex, tenant: 't1', existing: { id: 'pd-1' } as any });
    await directProvisioner.retry({ knex: fakeKnex, tenant: 't1', existing: { id: 'pd-1' } as any });
    expect(upsertPortalDomain).not.toHaveBeenCalled();
    expect(updatePortalDomain).not.toHaveBeenCalled();
    expect(enqueuePortalDomainWorkflow).not.toHaveBeenCalled();
  });
});

describe('surface + SSO redirect-URI gate (alga-2026-0002799)', () => {
  const regInput = (surface: 'client_portal' | 'msp' | 'both', existing: any = null) => ({
    knex: fakeKnex,
    tenant: 't1',
    canonicalHost: 'abc1234.portal.alga.acme.com',
    domain: 'helpdesk.acme.com',
    existing,
    domainChanged: false,
    surface,
  });
  const providerEnv = { GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret' };

  beforeEach(() => {
    delete process.env.PORTAL_DOMAIN_SSO_REDIRECT_URIS_PREREGISTERED;
    for (const key of Object.keys(providerEnv)) delete (process.env as any)[key];
    for (const key of Object.keys(tenantSecrets)) delete tenantSecrets[key];
    msSsoReady.value = false;
  });

  it('direct: a TENANT-configured IdP (no platform provider) gates an msp domain and names the URI to register', async () => {
    tenantSecrets.google_client_id = 'tenant-google-id';
    tenantSecrets.google_client_secret = 'tenant-google-secret';
    msSsoReady.value = true;
    await directProvisioner.register(regInput('msp'));
    const input = upsertPortalDomain.mock.calls[0][2];
    expect(input.status).toBe('pending_redirect_uri');
    expect(input.verificationDetails.sso_redirect_uris.required).toEqual([
      'https://helpdesk.acme.com/api/auth/callback/azure-ad',
      'https://helpdesk.acme.com/api/auth/callback/google',
    ]);
    // Actionable: the message names the exact URIs to paste into the provider console.
    expect(input.statusMessage).toContain('https://helpdesk.acme.com/api/auth/callback/google');
    expect(input.statusMessage).toContain('https://helpdesk.acme.com/api/auth/callback/azure-ad');
    expect(input.statusMessage).toMatch(/identity provider/i);
  });

  it('temporal: a tenant-configured IdP is also required for hosted msp domains', async () => {
    tenantSecrets.keycloak_url = 'https://kc.acme.com';
    tenantSecrets.keycloak_realm = 'acme';
    tenantSecrets.keycloak_client_id = 'alga';
    tenantSecrets.keycloak_client_secret = 'shh';
    await temporalProvisioner.register(regInput('both'));
    expect(upsertPortalDomain.mock.calls[0][2].verificationDetails.sso_redirect_uris.required).toEqual([
      'https://helpdesk.acme.com/api/auth/callback/keycloak',
    ]);
  });

  it('a client_portal-only domain is never gated, even with tenant SSO configured', async () => {
    tenantSecrets.google_client_id = 'tenant-google-id';
    tenantSecrets.google_client_secret = 'tenant-google-secret';
    await directProvisioner.register(regInput('client_portal'));
    expect(upsertPortalDomain.mock.calls[0][2].status).toBe('active');
  });

  it('direct: msp surface with SSO configured stays pending_redirect_uri until confirmed', async () => {
    Object.assign(process.env, providerEnv);
    await directProvisioner.register(regInput('msp'));
    const input = upsertPortalDomain.mock.calls[0][2];
    expect(input.surface).toBe('msp');
    expect(input.status).toBe('pending_redirect_uri');
    expect(input.verificationDetails.sso_redirect_uris.required).toEqual([
      'https://helpdesk.acme.com/api/auth/callback/google',
    ]);
    Object.keys(providerEnv).forEach((k) => delete (process.env as any)[k]);
  });

  it('direct: msp surface activates when no SSO provider needs a redirect URI', async () => {
    await directProvisioner.register(regInput('both'));
    expect(upsertPortalDomain.mock.calls[0][2].status).toBe('active');
  });

  it('direct: pre-registered redirect URIs activate immediately', async () => {
    Object.assign(process.env, providerEnv, { PORTAL_DOMAIN_SSO_REDIRECT_URIS_PREREGISTERED: 'true' });
    await directProvisioner.register(regInput('msp'));
    expect(upsertPortalDomain.mock.calls[0][2].status).toBe('active');
    Object.keys(providerEnv).forEach((k) => delete (process.env as any)[k]);
  });

  it('direct: changing the surface updates the existing row in place (matchSurface)', async () => {
    await directProvisioner.register(regInput('both', { surface: 'client_portal', domain: 'helpdesk.acme.com', verificationDetails: {} }));
    expect(upsertPortalDomain.mock.calls[0][2].matchSurface).toBe('client_portal');
  });

  it('direct: refresh activates a pending_redirect_uri row once confirmed', async () => {
    const existing: any = {
      id: 'pd-1',
      domain: 'helpdesk.acme.com',
      surface: 'msp',
      status: 'pending_redirect_uri',
      verificationDetails: { sso_redirect_uris: { required: ['u'], confirmed: ['u'] } },
    };
    await directProvisioner.refresh({ knex: fakeKnex, tenant: 't1', existing });
    expect(updatePortalDomain.mock.calls[0][2]).toEqual({ id: 'pd-1' });
    expect(updatePortalDomain.mock.calls[0][3].status).toBe('active');
  });

  it('direct: refresh leaves an unconfirmed pending_redirect_uri row alone', async () => {
    const existing: any = {
      domain: 'helpdesk.acme.com',
      surface: 'msp',
      status: 'pending_redirect_uri',
      verificationDetails: { sso_redirect_uris: { required: ['u'], confirmed: [] } },
    };
    await directProvisioner.refresh({ knex: fakeKnex, tenant: 't1', existing });
    expect(updatePortalDomain).not.toHaveBeenCalled();
  });

  it('temporal: passes surface to the row and the workflow and stores the redirect-URI state', async () => {
    Object.assign(process.env, providerEnv);
    await temporalProvisioner.register(regInput('msp'));
    const input = upsertPortalDomain.mock.calls[0][2];
    expect(input.surface).toBe('msp');
    expect(input.status).toBe('pending_dns');
    expect(input.verificationDetails.sso_redirect_uris.required).toHaveLength(1);
    expect(enqueuePortalDomainWorkflow.mock.calls[0][0].surface).toBe('msp');
    Object.keys(providerEnv).forEach((k) => delete (process.env as any)[k]);
  });
});

describe('temporalProvisioner (hosted, regression)', () => {
  it('register upserts pending_dns and enqueues with the register trigger', async () => {
    const result = await temporalProvisioner.register({
      knex: fakeKnex,
      tenant: 't1',
      canonicalHost: 'abc1234.portal.algapsa.com',
      domain: 'portal.acme.com',
      existing: null,
      domainChanged: false,
      surface: 'client_portal',
    });

    expect(result.enqueued).toBe(true);
    expect(upsertPortalDomain).toHaveBeenCalledTimes(1);
    expect(upsertPortalDomain.mock.calls[0][2].status).toBe('pending_dns');
    expect(enqueuePortalDomainWorkflow).toHaveBeenCalledTimes(1);
    expect(enqueuePortalDomainWorkflow.mock.calls[0][0].trigger).toBe('register');
  });

  it('register on a changed domain enqueues with the refresh trigger', async () => {
    await temporalProvisioner.register({
      knex: fakeKnex,
      tenant: 't1',
      canonicalHost: 'abc1234.portal.algapsa.com',
      domain: 'new.acme.com',
      existing: { id: 'pd-1', domain: 'old.acme.com' } as any,
      domainChanged: true,
      surface: 'client_portal',
    });
    expect(enqueuePortalDomainWorkflow.mock.calls[0][0].trigger).toBe('refresh');
  });

  it('disable updates the row to disabled and enqueues the disable trigger', async () => {
    await temporalProvisioner.disable({ knex: fakeKnex, tenant: 't1', existing: { id: 'pd-1', status: 'active' } as any });
    expect(updatePortalDomain).toHaveBeenCalledTimes(1);
    expect(updatePortalDomain.mock.calls[0][2]).toEqual({ id: 'pd-1' });
    expect(updatePortalDomain.mock.calls[0][3].status).toBe('disabled');
    expect(enqueuePortalDomainWorkflow.mock.calls[0][0].trigger).toBe('disable');
  });
});
