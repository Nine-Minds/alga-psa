import dns from 'node:dns/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSafeOutboundHost, assertSafeOutboundUrl, isBlockedOutboundAddress } from './outboundAddressPolicy';

vi.mock('node:dns/promises', () => ({ default: { lookup: vi.fn() } }));

const configuration = JSON.stringify({
  'imap.fixture.test': ['127.0.0.1'],
  'oauth.fixture.test': ['127.0.0.2'],
  '127.0.0.1': ['127.0.0.1'],
});

describe('development email destinations', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('ALGA_EMAIL_DEV_DESTINATIONS', '');
    vi.mocked(dns.lookup).mockReset();
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as any);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects private IMAP and HTTPS OAuth destinations by default', async () => {
    vi.stubEnv('ALGA_EMAIL_DEV_DESTINATIONS', undefined);
    await expect(assertSafeOutboundHost('127.0.0.1')).rejects.toThrow('non-public');
    await expect(assertSafeOutboundUrl('https://oauth.fixture.test/token')).rejects.toThrow('non-public');
  });

  it.each(['development', 'test'])('allows only configured fixture host/IP pairs in %s', async (environment) => {
    vi.stubEnv('NODE_ENV', environment);
    vi.stubEnv('ALGA_EMAIL_DEV_DESTINATIONS', configuration);
    await expect(assertSafeOutboundHost('IMAP.FIXTURE.TEST.')).resolves.toBeUndefined();
    await expect(assertSafeOutboundHost('127.0.0.1')).resolves.toBeUndefined();
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '127.0.0.2', family: 4 }] as any);
    for (const path of ['/authorize', '/token', '/issuer']) {
      await expect(assertSafeOutboundUrl(`https://oauth.fixture.test:23956${path}`)).resolves.toBeUndefined();
    }
    expect(isBlockedOutboundAddress('127.0.0.1')).toBe(true);
  });

  it.each(['production', '', 'staging'])('ignores configured exceptions in environment %j', async (environment) => {
    vi.stubEnv('NODE_ENV', environment);
    vi.stubEnv('ALGA_EMAIL_DEV_DESTINATIONS', configuration);
    await expect(assertSafeOutboundHost('imap.fixture.test')).rejects.toThrow('non-public');
    await expect(assertSafeOutboundUrl('https://127.0.0.1/token')).rejects.toThrow('non-public');
  });

  it('fails closed when NODE_ENV is absent', async () => {
    vi.stubEnv('NODE_ENV', undefined);
    vi.stubEnv('ALGA_EMAIL_DEV_DESTINATIONS', configuration);
    await expect(assertSafeOutboundHost('127.0.0.1')).rejects.toThrow('non-public');
  });

  it('does not let a configured address authorize a different hostname', async () => {
    vi.stubEnv('ALGA_EMAIL_DEV_DESTINATIONS', configuration);
    await expect(assertSafeOutboundHost('other.fixture.test')).rejects.toThrow('non-public');
    await expect(assertSafeOutboundHost('sub.imap.fixture.test')).rejects.toThrow('non-public');
  });

  it('resolves configured names normally and rejects changed or mixed DNS answers', async () => {
    vi.stubEnv('ALGA_EMAIL_DEV_DESTINATIONS', configuration);
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as any);
    await expect(assertSafeOutboundHost('imap.fixture.test')).rejects.toThrow('non-public');
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }, { address: '10.0.0.1', family: 4 }] as any);
    await expect(assertSafeOutboundHost('imap.fixture.test')).rejects.toThrow('non-public');
    vi.mocked(dns.lookup).mockResolvedValue([] as any);
    await expect(assertSafeOutboundHost('imap.fixture.test')).rejects.toThrow('could not be resolved');
    vi.mocked(dns.lookup).mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertSafeOutboundHost('imap.fixture.test')).rejects.toThrow('could not be resolved');
  });

  it('permits public destinations without an exception', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as any);
    await expect(assertSafeOutboundUrl('https://public.example.test/token')).resolves.toBeUndefined();
  });

  it('preserves HTTPS and embedded-credential restrictions for configured hosts', async () => {
    vi.stubEnv('ALGA_EMAIL_DEV_DESTINATIONS', configuration);
    await expect(assertSafeOutboundUrl('http://127.0.0.1/token')).rejects.toThrow('https');
    await expect(assertSafeOutboundUrl('https://user:password@127.0.0.1/token')).rejects.toThrow('credentials');
  });

  it.each([
    '{', '[]', 'null', '{"*": ["127.0.0.1"]}',
    '{"*.fixture.test": ["127.0.0.1"]}', '{"127.0.0.0/8": ["127.0.0.1"]}',
    '{"https://fixture.test": ["127.0.0.1"]}', '{"fixture.test": ["127.0.0.0/8"]}',
    '{"fixture.test": []}', '{"fixture.test": "127.0.0.1"}',
    '{"fixture.test": ["localhost"]}', '{"fixture.test": [null]}',
    '{"fixture.test": ["fe80::1%eth0"]}',
  ])('fails closed on malformed or broad configuration: %s', async (configuration) => {
    vi.stubEnv('ALGA_EMAIL_DEV_DESTINATIONS', configuration);
    await expect(assertSafeOutboundHost('127.0.0.1')).rejects.toThrow('ALGA_EMAIL_DEV_DESTINATIONS');
  });

  it('normalizes exact IPv6 addresses and permits explicitly configured localhost', async () => {
    vi.stubEnv('ALGA_EMAIL_DEV_DESTINATIONS', JSON.stringify({ '::1': ['0:0:0:0:0:0:0:1'], localhost: ['::1', '127.0.0.1'] }));
    await expect(assertSafeOutboundUrl('https://[::1]:23956/token')).resolves.toBeUndefined();
    await expect(assertSafeOutboundHost('localhost')).resolves.toBeUndefined();
    await expect(assertSafeOutboundHost('::ffff:127.0.0.1')).rejects.toThrow('non-public');
  });

  it('does not parse development configuration in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALGA_EMAIL_DEV_DESTINATIONS', '{invalid');
    await expect(assertSafeOutboundHost('127.0.0.1')).rejects.toThrow('non-public');
    await expect(assertSafeOutboundHost('8.8.8.8')).resolves.toBeUndefined();
  });
});
