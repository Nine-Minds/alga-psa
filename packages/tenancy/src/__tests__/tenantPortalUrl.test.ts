import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const statusMock = vi.hoisted(() => vi.fn());
const warnMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/portalDomainStatus', () => ({ getPortalDomainStatusForTenant: statusMock }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { warn: warnMock, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { buildTenantPortalUrl, getTenantPortalBaseUrl } from '../lib/tenantPortalUrl';

const ENV_KEYS = ['NEXT_PUBLIC_BASE_URL', 'NEXTAUTH_URL', 'HOST'] as const;
const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
const QUOTE_PATH = '/client-portal/billing/quotes/q-1';

describe('tenant portal URL helper', () => {
  beforeEach(() => {
    statusMock.mockReset();
    warnMock.mockReset();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('uses an active custom domain for the quote deep link', async () => {
    process.env.NEXTAUTH_URL = 'https://algapsa.com';
    statusMock.mockResolvedValue({ status: 'active', domain: 'helpdesk.digitalchk.com' });

    await expect(buildTenantPortalUrl('t1', QUOTE_PATH)).resolves.toBe(
      'https://helpdesk.digitalchk.com/client-portal/billing/quotes/q-1',
    );
  });

  it('falls back to the base URL when the tenant has no domain', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://app.example.test';
    process.env.NEXTAUTH_URL = 'https://other.example.test';
    statusMock.mockResolvedValue({ status: 'disabled', domain: null });

    await expect(buildTenantPortalUrl('t1', QUOTE_PATH)).resolves.toBe(
      'https://app.example.test/client-portal/billing/quotes/q-1',
    );
  });

  it('orders NEXT_PUBLIC_BASE_URL, NEXTAUTH_URL, then https://$HOST', async () => {
    statusMock.mockResolvedValue({ status: 'disabled', domain: null });
    process.env.HOST = 'host.example.test';
    await expect(getTenantPortalBaseUrl('t1')).resolves.toBe('https://host.example.test');
    process.env.NEXTAUTH_URL = 'https://auth.example.test';
    await expect(getTenantPortalBaseUrl('t1')).resolves.toBe('https://auth.example.test');
    process.env.NEXT_PUBLIC_BASE_URL = 'https://public.example.test';
    await expect(getTenantPortalBaseUrl('t1')).resolves.toBe('https://public.example.test');
  });

  it('returns null (no link, never localhost) when nothing is configured', async () => {
    statusMock.mockResolvedValue({ status: 'disabled', domain: null });

    await expect(getTenantPortalBaseUrl('t1')).resolves.toBeNull();
    await expect(buildTenantPortalUrl('t1', QUOTE_PATH)).resolves.toBeNull();
  });

  it.each(['pending_dns', 'verifying', 'failed', 'disabled', 'certificate_failed'])(
    'never uses a custom domain whose status is %s',
    async (status) => {
      process.env.NEXTAUTH_URL = 'https://algapsa.com';
      statusMock.mockResolvedValue({ status, domain: 'helpdesk.digitalchk.com' });

      const url = await buildTenantPortalUrl('t1', QUOTE_PATH);
      expect(url).toBe('https://algapsa.com/client-portal/billing/quotes/q-1');
      expect(url).not.toContain('digitalchk');
      expect(warnMock).toHaveBeenCalled();
    },
  );

  it('warns and uses the base URL when the status lookup throws', async () => {
    process.env.NEXTAUTH_URL = 'https://algapsa.com';
    statusMock.mockRejectedValue(new Error('db down'));

    await expect(getTenantPortalBaseUrl('t1')).resolves.toBe('https://algapsa.com');
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('Failed to resolve custom portal domain'), expect.anything());
  });

  it('skips an invalid base URL and appends query params', async () => {
    statusMock.mockResolvedValue({ status: 'disabled', domain: null });
    process.env.NEXT_PUBLIC_BASE_URL = 'not a url';
    process.env.NEXTAUTH_URL = 'https://auth.example.test';

    await expect(
      buildTenantPortalUrl('t1', '/client-portal/billing', { tab: 'invoices', invoiceId: 'i-1', skip: undefined }),
    ).resolves.toBe('https://auth.example.test/client-portal/billing?tab=invoices&invoiceId=i-1');
  });
});
