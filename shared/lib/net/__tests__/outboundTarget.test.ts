import { describe, expect, it, vi } from 'vitest';
import {
  assertSafeOutboundTarget,
  createPinnedOutboundLookup,
  isBlockedOutboundAddress,
  parseOutboundTargetAllowlist,
  resolveSafeOutboundTarget,
  UnsafeOutboundTargetError,
} from '../outboundTarget';

describe('shared outbound target policy', () => {
  it.each([
    '127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1',
    '192.0.2.1', '198.18.0.1', '224.0.0.1', '::1', 'fc00::1',
    'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:a00:1', '2001:db8::1',
  ])('blocks reserved or non-public address %s', (address) => {
    expect(isBlockedOutboundAddress(address)).toBe(true);
  });

  it('accepts public addresses and HTTPS, rejects malformed URLs and prohibited schemes', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    await expect(assertSafeOutboundTarget('https://example.test/token', { schemes: ['https'], lookup })).resolves.toBeInstanceOf(URL);
    await expect(assertSafeOutboundTarget('http://example.test/token', { schemes: ['https'], lookup })).rejects.toBeInstanceOf(UnsafeOutboundTargetError);
    await expect(assertSafeOutboundTarget('not a URL', { schemes: ['https'], lookup })).rejects.toBeInstanceOf(UnsafeOutboundTargetError);
  });

  it('rejects a host if any DNS answer is private and permits it only when explicitly allowlisted', async () => {
    const lookup = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.2.3.4', family: 4 },
    ]);
    await expect(assertSafeOutboundTarget('imap://mail.example.test', { schemes: ['imap'], lookup }))
      .rejects.toBeInstanceOf(UnsafeOutboundTargetError);
    await expect(assertSafeOutboundTarget('imap://mail.example.test', {
      schemes: ['imap'], lookup, privateTargetAllowlist: ['MAIL.EXAMPLE.TEST.'],
    })).resolves.toBeInstanceOf(URL);
  });

  it('rejects localhost aliases even when private destinations are allowlisted', async () => {
    await expect(assertSafeOutboundTarget('https://api.localhost', {
      schemes: ['https'], allowPrivateTargets: true,
    })).rejects.toBeInstanceOf(UnsafeOutboundTargetError);
  });

  it('returns a pinned validated address and rejects ports outside the destination profile', async () => {
    const lookup = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    const target = await resolveSafeOutboundTarget('https://example.test/token', {
      schemes: ['https'], ports: [443], lookup,
    });
    const pinnedLookup = createPinnedOutboundLookup(target.pin);
    const result = await new Promise((resolve, reject) => {
      pinnedLookup('example.test', { all: true }, (error, addresses) =>
        error ? reject(error) : resolve(addresses)
      );
    });
    expect(result).toEqual([{ address: '93.184.216.34', family: 4 }]);
    expect(lookup).toHaveBeenCalledTimes(1);
    await expect(resolveSafeOutboundTarget('https://example.test:444/token', {
      schemes: ['https'], ports: [443], lookup,
    })).rejects.toBeInstanceOf(UnsafeOutboundTargetError);
  });

  it.each(['127.0.0.1', '169.254.169.254', '100.64.0.1', '192.0.2.1'])('does not let the IMAP allowlist permit loopback, metadata, CGNAT, or reserved address %s', async (address) => {
      await expect(assertSafeOutboundTarget('imap://mail.example.test', {
        schemes: ['imap'],
        privateTargetAllowlist: ['mail.example.test'],
        lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
      })).rejects.toBeInstanceOf(UnsafeOutboundTargetError);
    });

  it.each(['*.example.test', 'http://mail.example.test', 'mail.example.test:993', '10.0.0.0/8'])('rejects unsupported allowlist syntax %s', (value) => {
      expect(() => parseOutboundTargetAllowlist(value)).toThrow();
    });
});
