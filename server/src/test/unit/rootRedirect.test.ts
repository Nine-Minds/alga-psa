import logger from '@alga-psa/core/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRootRedirect } from '../../lib/deployment/rootRedirect';

describe('resolveRootRedirect', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the MSP dashboard for the canonical host without a lookup', async () => {
    const lookupPortalDomain = vi.fn();

    await expect(resolveRootRedirect({
      hostname: 'app.example.com',
      hostHeader: 'app.example.com',
      canonicalHostname: 'app.example.com',
      lookupPortalDomain,
    })).resolves.toBe('/msp/dashboard');
    expect(lookupPortalDomain).not.toHaveBeenCalled();
  });

  it('returns the client portal for any matching portal-domain row', async () => {
    const lookupPortalDomain = vi.fn().mockResolvedValue({ status: 'disabled' });

    await expect(resolveRootRedirect({
      hostname: 'portal.example.com',
      hostHeader: 'portal.example.com',
      canonicalHostname: 'app.example.com',
      lookupPortalDomain,
    })).resolves.toBe('/client-portal');
  });

  it('returns the MSP dashboard for an unknown host', async () => {
    await expect(resolveRootRedirect({
      hostname: 'unknown.example.com',
      hostHeader: 'unknown.example.com',
      canonicalHostname: 'app.example.com',
      lookupPortalDomain: vi.fn().mockResolvedValue(null),
    })).resolves.toBe('/msp/dashboard');
  });

  it('fails toward the MSP dashboard and logs when lookup throws', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(resolveRootRedirect({
      hostname: 'portal.example.com',
      hostHeader: 'portal.example.com',
      canonicalHostname: 'app.example.com',
      lookupPortalDomain: vi.fn().mockRejectedValue(new Error('database unavailable')),
    })).resolves.toBe('/msp/dashboard');
    expect(warn).toHaveBeenCalledWith(
      'Failed to resolve root redirect for request host',
      expect.objectContaining({ hostname: 'portal.example.com' }),
    );
  });

  it('still performs a lookup when the canonical hostname is unavailable', async () => {
    const lookupPortalDomain = vi.fn().mockResolvedValue({ id: 'domain-1' });

    await expect(resolveRootRedirect({
      hostname: 'portal.example.com',
      hostHeader: 'portal.example.com',
      canonicalHostname: null,
      lookupPortalDomain,
    })).resolves.toBe('/client-portal');
    expect(lookupPortalDomain).toHaveBeenCalledWith('portal.example.com');
  });

  it('tries a non-standard port before the bare hostname', async () => {
    const lookupPortalDomain = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'domain-1' });

    await expect(resolveRootRedirect({
      hostname: 'portal.example.com',
      hostHeader: 'portal.example.com:3553',
      canonicalHostname: 'app.example.com',
      lookupPortalDomain,
    })).resolves.toBe('/client-portal');
    expect(lookupPortalDomain.mock.calls).toEqual([
      ['portal.example.com:3553'],
      ['portal.example.com'],
    ]);
  });
});
