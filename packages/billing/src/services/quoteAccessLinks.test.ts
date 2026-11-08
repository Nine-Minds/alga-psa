import { beforeEach, describe, expect, it, vi } from 'vitest';

// The only DB access for an unknown (well-formed) token is the tenantless lookup, which finds nothing.
const dbCalls = vi.hoisted(() => ({ lookups: 0 }));
vi.mock('@alga-psa/db', () => {
  const chain: any = {
    select: () => chain,
    where: () => chain,
    first: async () => {
      dbCalls.lookups += 1;
      return undefined;
    },
  };
  return {
    getConnection: vi.fn(async () => ({})),
    tenantDb: vi.fn(() => ({ unscoped: () => chain })),
  };
});

import {
  computeQuoteAccessExpiry,
  generateQuoteAccessToken,
  hashQuoteAccessToken,
  isWellFormedQuoteAccessToken,
  resetQuoteAccessRateLimiters,
  resolve,
  QUOTE_ACCESS_TOKEN_LENGTH,
} from './quoteAccessLinks';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-01T12:00:00.000Z');

beforeEach(() => {
  resetQuoteAccessRateLimiters();
  dbCalls.lookups = 0;
});

describe('token generation and hashing', () => {
  it('produces 256-bit base64url tokens', () => {
    const token = generateQuoteAccessToken();
    expect(token).toHaveLength(QUOTE_ACCESS_TOKEN_LENGTH);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(isWellFormedQuoteAccessToken(token)).toBe(true);
    expect(generateQuoteAccessToken()).not.toBe(token);
  });

  it('hashes deterministically to 64 lowercase hex chars', () => {
    const h = hashQuoteAccessToken('abc');
    expect(h).toBe(hashQuoteAccessToken('abc'));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('computeQuoteAccessExpiry', () => {
  it('defaults to now+30d when valid_until is null', () => {
    expect(computeQuoteAccessExpiry(null, NOW).getTime()).toBe(NOW.getTime() + 30 * DAY);
  });

  it('caps at now+90d', () => {
    expect(computeQuoteAccessExpiry('2027-12-31T00:00:00Z', NOW).getTime()).toBe(NOW.getTime() + 90 * DAY);
  });

  it('treats valid_until as end of that UTC day', () => {
    // 2026-06-11 -> expires at start of 2026-06-12 UTC
    expect(computeQuoteAccessExpiry('2026-06-11T00:00:00Z', NOW).toISOString()).toBe('2026-06-12T00:00:00.000Z');
    expect(computeQuoteAccessExpiry('2026-06-11T23:59:00Z', NOW).toISOString()).toBe('2026-06-12T00:00:00.000Z');
  });

  it('floors at now+24h for past or imminent valid_until', () => {
    expect(computeQuoteAccessExpiry('2020-01-01T00:00:00Z', NOW).getTime()).toBe(NOW.getTime() + DAY);
    expect(computeQuoteAccessExpiry('2026-06-01T00:00:00Z', NOW).getTime()).toBe(NOW.getTime() + DAY);
  });
});

describe('resolve short-circuits', () => {
  it('returns not_found for malformed tokens without querying the DB', async () => {
    for (const bad of ['', 'short', 'x'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}!`]) {
      await expect(resolve(bad, {})).resolves.toEqual({ status: 'not_found' });
    }
    expect(dbCalls.lookups).toBe(0);
  });

  it('rate limits per token hash after 60 attempts', async () => {
    const token = 'a'.repeat(43);
    let last;
    for (let i = 0; i < 61; i += 1) last = await resolve(token, {});
    expect(last).toEqual({ status: 'rate_limited' });
  });

  it('rate limits per IP after 30 attempts across different tokens', async () => {
    let last;
    for (let i = 0; i < 31; i += 1) last = await resolve(`${String(i).padStart(43, 'b')}`, { ip: '203.0.113.9' });
    expect(last).toEqual({ status: 'rate_limited' });
    // A different IP is unaffected.
    await expect(resolve('c'.repeat(43), { ip: '203.0.113.10' })).resolves.toEqual({ status: 'not_found' });
  });
});
