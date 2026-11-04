import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => vi.fn());
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }));
vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: flag }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
  admits,
  registerCapabilityEligibility,
  registerCapabilityParticipation,
  resolveClientCapability,
  serves,
} from '@alga-psa/core/capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { resolveCapabilityBootstrap } from '../../../lib/capability/bootstrap';

describe('server/client agreement through the bootstrap', () => {
  afterEach(() => {
    delete process.env.FORCE_CAPABILITIES;
    resetCapabilityRegistry();
  });

  beforeEach(() => {
    delete process.env.FORCE_CAPABILITIES;
    flag.mockReset();
    registerCapabilityEligibility('co-managed', async ({ tenantId }) => tenantId === 'internal');
    registerCapabilityParticipation('co-managed', async (ctx: any) => ctx.tenantIds.filter((t: string) => t === 'internal'));
    clearCapabilityCache();
  });

  it.each([
    ['internal', true],
    ['control', false],
  ])('tenant %s: the client decision equals the server decision', async (tenant, expected) => {
    flag.mockResolvedValue(true);
    const bootstrap = await resolveCapabilityBootstrap(tenant);
    const client = resolveClientCapability({ capability: 'co-managed', bootstrap });
    expect(client).toMatchObject({ enabled: expected, admitted: expected, resolved: true });
    expect(client.enabled).toBe((await serves('co-managed', tenant)).served);
    expect(client.admitted).toBe((await admits('co-managed', tenant)).admitted);
    expect(bootstrap['release-v2-0-feature']).toBe(true);
  });

  it('forced off closes both sides while the Timeline flag value is untouched', async () => {
    flag.mockResolvedValue(true);
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    const bootstrap = await resolveCapabilityBootstrap('internal');
    expect(resolveClientCapability({ capability: 'co-managed', bootstrap })).toMatchObject({ enabled: false, admitted: false });
    expect(bootstrap['release-v2-0-feature']).toBe(true);
  });

  it('a throwing flag omits the raw value and fails admission closed; serves has no flag term', async () => {
    flag.mockRejectedValue(new Error('down'));
    const bootstrap = await resolveCapabilityBootstrap('internal');
    expect('release-v2-0-feature' in bootstrap).toBe(false);
    const client = resolveClientCapability({ capability: 'co-managed', bootstrap });
    expect(client.admitted).toBe(false);
    expect(client.enabled).toBe(true); // participation only, by design
  });

  it('no tenant yields an empty bootstrap and an unresolved, closed client', async () => {
    const bootstrap = await resolveCapabilityBootstrap(null);
    expect(bootstrap).toEqual({});
    expect(resolveClientCapability({ capability: 'co-managed', bootstrap })).toMatchObject({ enabled: false, resolved: false });
  });
});
