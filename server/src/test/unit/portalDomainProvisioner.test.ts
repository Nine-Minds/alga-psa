import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fns must be created via vi.hoisted so the (hoisted) vi.mock factories can reference them.
const { upsertPortalDomain, updatePortalDomain, deletePortalDomain, enqueuePortalDomainWorkflow } = vi.hoisted(() => ({
  upsertPortalDomain: vi.fn(),
  updatePortalDomain: vi.fn(),
  deletePortalDomain: vi.fn(),
  enqueuePortalDomainWorkflow: vi.fn(),
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
  directProvisioner,
  temporalProvisioner,
} from '@ee/lib/portal-domains/provisioner';

const fakeKnex = {} as any;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXTAUTH_URL;
  upsertPortalDomain.mockImplementation(async (_knex: unknown, _tenant: string, input: any) => ({ id: 'pd-1', ...input }));
  updatePortalDomain.mockImplementation(async (_knex: unknown, _tenant: string, patch: any) => ({ id: 'pd-1', ...patch }));
  deletePortalDomain.mockResolvedValue(undefined);
  enqueuePortalDomainWorkflow.mockResolvedValue({ enqueued: true });
});

describe('getPortalDomainProvisioner (factory)', () => {
  it('returns the direct driver for the appliance profile', () => {
    expect(getPortalDomainProvisioner({ DEPLOYMENT_PROFILE: 'appliance' })).toBe(directProvisioner);
  });

  it('returns the temporal driver by default / for hosted', () => {
    expect(getPortalDomainProvisioner({})).toBe(temporalProvisioner);
    expect(getPortalDomainProvisioner({ DEPLOYMENT_PROFILE: 'hosted' })).toBe(temporalProvisioner);
    expect(getPortalDomainProvisioner({ DEPLOYMENT_PROFILE: 'whatever' })).toBe(temporalProvisioner);
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
      })
    ).rejects.toThrow(/primary host/i);
    expect(upsertPortalDomain).not.toHaveBeenCalled();
  });

  it('disable deletes the row (OTTs cascade) and enqueues nothing', async () => {
    await directProvisioner.disable({ knex: fakeKnex, tenant: 't1', existing: { id: 'pd-1' } as any });
    expect(deletePortalDomain).toHaveBeenCalledWith(fakeKnex, 't1');
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

describe('temporalProvisioner (hosted, regression)', () => {
  it('register upserts pending_dns and enqueues with the register trigger', async () => {
    const result = await temporalProvisioner.register({
      knex: fakeKnex,
      tenant: 't1',
      canonicalHost: 'abc1234.portal.algapsa.com',
      domain: 'portal.acme.com',
      existing: null,
      domainChanged: false,
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
    });
    expect(enqueuePortalDomainWorkflow.mock.calls[0][0].trigger).toBe('refresh');
  });

  it('disable updates the row to disabled and enqueues the disable trigger', async () => {
    await temporalProvisioner.disable({ knex: fakeKnex, tenant: 't1', existing: { id: 'pd-1', status: 'active' } as any });
    expect(updatePortalDomain).toHaveBeenCalledTimes(1);
    expect(updatePortalDomain.mock.calls[0][2].status).toBe('disabled');
    expect(enqueuePortalDomainWorkflow.mock.calls[0][0].trigger).toBe('disable');
  });
});
