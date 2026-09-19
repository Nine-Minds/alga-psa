import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), consume: vi.fn(), suspended: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/db', () => ({ getConnection: async () => ({}), isTenantSuspended: mocks.suspended }));
vi.mock('../senderIdentity', () => ({ resolveTenantCompanyName: async () => 'MSP' }));
vi.mock('@alga-psa/core/rateLimit', () => ({ TokenBucketRateLimiter: { getInstance: () => ({ isReady: () => true, tryConsume: mocks.consume }) } }));
vi.mock('../DelayedEmailQueue', () => ({ DelayedEmailQueue: { MAX_RETRIES: 5, calculateDelay: () => 60000,
  getInstance: () => ({ isReady: () => true, enqueue: mocks.enqueue }) } }));
import { TenantEmailService } from '../TenantEmailService';
beforeEach(() => {
  mocks.enqueue.mockReset().mockResolvedValue(undefined); mocks.suspended.mockReset().mockResolvedValue(false);
  mocks.consume.mockReset().mockResolvedValue({ allowed: false, reason: 'tenant_limit', retryAfterMs: 45000 });
});
it('returns retryable rate limiting without caching a rendered message owned by a durable caller', async () => {
  const tenant = randomUUID(), userId = randomUUID(), process = vi.fn();
  const result = await TenantEmailService.getInstance(tenant).sendEmail({ to: 'recipient@example.test', userId,
    retryPolicy: 'caller', templateProcessor: { process }, _retryCount: 99 });
  expect(result).toEqual({ success: false, error: 'Rate limit exceeded: tenant_limit', metadata: { retryable: true, errorCode: 'rate_limited', retryAfterMs: 45000 } });
  expect(mocks.consume).toHaveBeenCalledWith('email', tenant, userId);
  expect(mocks.enqueue).not.toHaveBeenCalled(); expect(process).not.toHaveBeenCalled();
});
it('preserves generic queueing for callers using the existing default', async () => {
  const tenant = randomUUID(), params = { to: 'recipient@example.test', subject: 'Queued', html: '<p>Body</p>' };
  expect(await TenantEmailService.getInstance(tenant).sendEmail(params)).toMatchObject({ success: true, queued: true });
  expect(mocks.enqueue).toHaveBeenCalledWith(tenant, params, 0);
});
it('preserves caller-owned retry through the legacy static entry point', async () => {
  const process = vi.fn();
  expect(await TenantEmailService.sendEmail({ tenantId: randomUUID(), to: 'recipient@example.test', retryPolicy: 'caller', templateProcessor: { process } })).toMatchObject({ success: false, metadata: { retryable: true } });
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it('still denies a suspended tenant before rate limiting or queueing', async () => {
  mocks.suspended.mockResolvedValue(true);
  expect(await TenantEmailService.getInstance(randomUUID()).sendEmail({ to: 'recipient@example.test', retryPolicy: 'caller' })).toMatchObject({ success: false, error: 'Tenant is suspended; outbound email is disabled' });
  expect(mocks.consume).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
});
