// T025 (F072-F075): per-principal rate limit bucket, precedence and ceiling.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tryConsume: vi.fn(),
  getter: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({ getConnection: vi.fn(), tenantDb: () => ({ table: () => ({ where: () => ({ first: async () => ({ user_id: 'u', archived_at: null, allow_act_as: false }) }) }) }), registerTenantTables: vi.fn() }));
vi.mock('@alga-psa/users/actions', () => ({ findUserByIdForApi: vi.fn() }));
vi.mock('@alga-psa/licensing', () => ({ getLicenseStateRow: vi.fn(), verifyLicense: vi.fn() }));
vi.mock('server/src/lib/api/rateLimit/apiRateLimitSettingsModel', () => ({ getForKey: vi.fn() }));
vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: { getInstance: () => ({ tryConsume: mocks.tryConsume }) },
}));
vi.mock('server/src/lib/api/rateLimit/apiRateLimitConfigGetter', () => ({
  apiRateLimitConfigGetter: mocks.getter,
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { resolvePrincipalRateLimit } from '../../lib/service-principals/boundary';
import { updateServicePrincipal } from '../../lib/service-principals/service';
import { enforceApiRateLimit } from '../../../../../server/src/lib/api/rateLimit/enforce';

const noOverride = { rate_limit_max_tokens: null, rate_limit_refill_per_min: null };

describe('service principal rate limits (T025)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getter.mockResolvedValue({ maxTokens: 120, refillRate: 1 });
    mocks.tryConsume.mockResolvedValue({ allowed: true, remaining: 119 });
  });

  it('defaults to the Pro 120 burst / 60 per minute (tokens per second)', () => {
    expect(resolvePrincipalRateLimit({ principal: noOverride })).toEqual({ maxTokens: 120, refillRate: 1 });
  });

  it('principal override beats the default but is capped at the ceiling', () => {
    expect(
      resolvePrincipalRateLimit({ principal: { rate_limit_max_tokens: 20, rate_limit_refill_per_min: 30 } }),
    ).toEqual({ maxTokens: 20, refillRate: 0.5 });
    expect(
      resolvePrincipalRateLimit({ principal: { rate_limit_max_tokens: 9999, rate_limit_refill_per_min: 9999 } }),
    ).toEqual({ maxTokens: 120, refillRate: 1 });
  });

  it('a per-key row beats the principal override', () => {
    expect(
      resolvePrincipalRateLimit({
        keyRow: { maxTokens: 5, refillPerMin: 6 },
        principal: { rate_limit_max_tokens: 20, rate_limit_refill_per_min: 30 },
      }),
    ).toEqual({ maxTokens: 5, refillRate: 0.1 });
  });

  it('rejects an override above the ceiling', async () => {
    await expect(
      updateServicePrincipal({ fn: { now: () => 'now' } } as never, 't', 'u', { rateLimitMaxTokens: 121, rateLimitRefillPerMin: 60 } as never),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT_ABOVE_CEILING' });
    await expect(
      updateServicePrincipal({ fn: { now: () => 'now' } } as never, 't', 'u', { rateLimitMaxTokens: 120, rateLimitRefillPerMin: 61 } as never),
    ).rejects.toMatchObject({ code: 'RATE_LIMIT_ABOVE_CEILING' });
  });

  it('two keys of one principal share the sp:<id> bucket and use the context config', async () => {
    const config = resolvePrincipalRateLimit({ principal: noOverride });
    for (const apiKeyId of ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']) {
      await enforceApiRateLimit('http://localhost/api/v1/tickets', {
        tenant: 't',
        apiKeyId,
        rateLimitSubjectId: 'sp:svc-1',
        rateLimitConfig: config,
      } as never);
    }
    expect(mocks.tryConsume).toHaveBeenCalledTimes(2);
    for (const call of mocks.tryConsume.mock.calls) {
      expect(call.slice(0, 4)).toEqual(['api', 't', 'sp:svc-1', 1]);
      expect(call[4]).toEqual(config);
    }
  });
});
