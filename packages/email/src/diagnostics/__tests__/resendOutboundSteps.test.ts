import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildResendOutboundSteps } from '../resendOutboundSteps';
import type { OutboundDiagnosticsContext } from '../outboundTypes';

const get = vi.fn();
const create = vi.fn((..._args: unknown[]) => ({ get }));
vi.mock('axios', () => ({ default: { create: (...args: unknown[]) => create(...args) } }));

function makeContext(rawConfig: Record<string, any>): OutboundDiagnosticsContext {
  return {
    tenant: 'tenant-1',
    knex: {} as any,
    settings: {} as any,
    options: { liveSendTest: false, includeIdentifiers: false },
    provider: { providerId: 'resend-1', providerType: 'resend', rawConfig },
    liveSend: async () => ({ success: true }),
    checkedCapabilities: [],
  } as any;
}

beforeEach(() => {
  get.mockReset();
  create.mockClear();
});

describe('resend steps', () => {
  it('fails configuration without an API key and skips the domains call', async () => {
    const steps = buildResendOutboundSteps();
    const ctx = makeContext({});
    expect((await steps.find((s) => s.id === 'resend_configuration')!.run(ctx)).status).toBe('fail');
    expect((await steps.find((s) => s.id === 'resend_domains_check')!.run(ctx)).status).toBe('skip');
    expect(create).not.toHaveBeenCalled();
  });

  it('bypasses the cache and preserves the domains result with status and request id', async () => {
    get.mockResolvedValue({
      status: 200,
      data: { data: [{ id: 'd1', name: 'example.com', status: 'verified' }] },
      headers: { 'x-request-id': 'resend-req-1' },
    });
    const steps = buildResendOutboundSteps();
    const ctx = makeContext({ apiKey: 'key' });
    await steps.find((s) => s.id === 'resend_configuration')!.run(ctx);
    const outcome = await steps.find((s) => s.id === 'resend_domains_check')!.run(ctx);

    expect(outcome.status).toBe('pass');
    expect(outcome.http).toMatchObject({ path: '/domains', status: 200, requestId: 'resend-req-1' });
    expect(outcome.data).toMatchObject({ cacheBypassed: true, domainCount: 1 });
    expect(outcome.recommendations).toBeUndefined();
    expect(outcome.detail).toMatch(/Send a test email to check sending/);
  });

  it('reports a restricted-key denial as warn, not as proof sending is forbidden', async () => {
    get.mockRejectedValue({
      response: { status: 403, headers: { 'x-request-id': 'resend-req-2' }, data: { message: 'restricted_api_key' } },
      message: 'Request failed',
    });
    const steps = buildResendOutboundSteps();
    const ctx = makeContext({ apiKey: 'key' });
    const outcome = await steps.find((s) => s.id === 'resend_domains_check')!.run(ctx);

    expect(outcome.status).toBe('warn');
    expect(outcome.error).toMatchObject({ message: 'restricted_api_key', status: 403, requestId: 'resend-req-2' });
    expect(outcome.data).toMatchObject({ denied: true });
    expect(outcome.detail).toMatch(/Some API keys allow sending email without access to domain settings/);
    expect(outcome.recommendations).toEqual([]);
  });

  it('treats an invalid API key as a real failure, not a restricted-key inspection limit', async () => {
    get.mockRejectedValue({ response: { status: 401, data: { message: 'API key is invalid' } } });
    const outcome = await buildResendOutboundSteps().find(step => step.id === 'resend_domains_check')!.run(makeContext({ apiKey: 'invalid' }));
    expect(outcome.status).toBe('fail');
    expect(outcome.data).toMatchObject({ denied: false });
    expect(outcome.detail).toMatch(/did not accept the API key/);
    expect(outcome.recommendations).toEqual(['Update the Resend API key in email settings.']);
  });

  it('fails on network errors without inventing an HTTP status', async () => {
    get.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    const steps = buildResendOutboundSteps();
    const ctx = makeContext({ apiKey: 'key' });
    const outcome = await steps.find((s) => s.id === 'resend_domains_check')!.run(ctx);

    expect(outcome.status).toBe('fail');
    expect(outcome.http?.status).toBeUndefined();
    expect(outcome.error?.status).toBeUndefined();
    expect(outcome.error?.message).toContain('getaddrinfo');
  });
});
