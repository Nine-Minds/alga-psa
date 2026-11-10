import { afterEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({
  default: { lookup: (...args: unknown[]) => lookup(...args) },
  lookup: (...args: unknown[]) => lookup(...args),
}));

import { assertSafeImapHost, assertSafeImapOauthTokenEndpoint } from '../imapOutboundTarget';

describe('IMAP destination policy', () => {
  const previousAllowlist = process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST;
  afterEach(() => {
    vi.resetAllMocks();
    if (previousAllowlist === undefined) delete process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST;
    else process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST = previousAllowlist;
  });

  it('denies private IMAP destinations by default and permits only exact allowlisted names', async () => {
    lookup.mockResolvedValue([{ address: '10.40.8.12', family: 4 }]);
    delete process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST;
    await expect(assertSafeImapHost('imap.internal.example', 993)).rejects.toThrow(/blocked private address/);

    process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST = 'IMAP.INTERNAL.EXAMPLE.';
    const target = await assertSafeImapHost('imap.internal.example', 993);
    expect(target.url.port).toBe('993');
    expect(target.pin).toEqual({ address: '10.40.8.12', family: 4 });
  });

  it.each([
    ['imap.internal.example', '169.254.169.254'],
    ['imap.internal.example', '100.64.0.2'],
    ['imap.internal.example', '127.0.0.1'],
    ['imap.internal.example', '::ffff:169.254.169.254'],
    ['other.internal.example', '10.40.8.12'],
  ])('keeps the exact private-target exception narrow for %s -> %s', async (host, address) => {
    process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST = 'imap.internal.example';
    lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);
    await expect(assertSafeImapHost(host, 993)).rejects.toThrow();
  });

  it('rejects non-mail ports and refuses to apply the IMAP exception to OAuth HTTPS', async () => {
    process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST = 'imap.internal.example';
    lookup.mockResolvedValue([{ address: '10.40.8.12', family: 4 }]);
    await expect(assertSafeImapHost('imap.internal.example', 25)).rejects.toThrow(/port 25/);
    await expect(assertSafeImapOauthTokenEndpoint('https://imap.internal.example/token'))
      .rejects.toThrow(/blocked private address/);
  });

  it('rejects a DNS name when any answer is unsafe', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: 'fc00::1', family: 6 },
    ]);
    await expect(assertSafeImapHost('mixed.example.test', 993)).rejects.toThrow(/blocked private address/);
  });
});
