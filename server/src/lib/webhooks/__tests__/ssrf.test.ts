import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dnsState = vi.hoisted(() => ({
  lookupMock: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  default: {
    lookup: (...args: unknown[]) => dnsState.lookupMock(...args),
  },
  lookup: (...args: unknown[]) => dnsState.lookupMock(...args),
}));

import { assertSafeWebhookTarget, UnsafeWebhookTargetError } from '../ssrf';

const PUBLIC_ADDRESS = '93.184.216.34';

const REJECTED_TARGETS: Array<[string, string]> = [
  ['http://127.0.0.1', 'loopback IPv4'],
  ['http://localhost', 'localhost hostname'],
  ['http://[::1]', 'IPv6 loopback'],
  ['http://10.0.0.5', 'RFC1918 10/8'],
  ['http://172.16.5.5', 'RFC1918 172.16/12'],
  ['http://192.168.1.1', 'RFC1918 192.168/16'],
  ['http://169.254.169.254', 'link-local 169.254/16'],
  ['http://100.64.0.1', 'CGNAT 100.64/10'],
  ['file:///etc/passwd', 'non-http(s) file scheme'],
  ['ftp://example.com', 'non-http(s) ftp scheme'],
];

describe('assertSafeWebhookTarget (T024)', () => {
  const originalAllowPrivate = process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;

  beforeEach(() => {
    delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
    dnsState.lookupMock.mockReset();
    dnsState.lookupMock.mockResolvedValue([{ address: PUBLIC_ADDRESS, family: 4 }]);
  });

  afterEach(() => {
    if (originalAllowPrivate === undefined) {
      delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
    } else {
      process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = originalAllowPrivate;
    }
  });

  it.each(REJECTED_TARGETS)('rejects %s (%s)', async (target) => {
    await expect(assertSafeWebhookTarget(target)).rejects.toBeInstanceOf(
      UnsafeWebhookTargetError,
    );
  });

  it('accepts https://example.com when DNS resolves to a public address', async () => {
    await expect(assertSafeWebhookTarget('https://example.com')).resolves.toBeUndefined();
    expect(dnsState.lookupMock).toHaveBeenCalledTimes(1);
  });

  it('allows the private addresses when WEBHOOK_SSRF_ALLOW_PRIVATE=true', async () => {
    process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = 'true';

    for (const [target] of REJECTED_TARGETS) {
      await expect(assertSafeWebhookTarget(target)).resolves.toBeUndefined();
    }

    // DNS is bypassed entirely under the override, so the lookup spy stays untouched.
    expect(dnsState.lookupMock).not.toHaveBeenCalled();
  });
});
