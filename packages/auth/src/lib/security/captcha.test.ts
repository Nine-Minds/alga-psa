import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const secrets: Record<string, string | undefined> = {};

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: vi.fn(async (name: string) => secrets[name]),
  })),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getCaptchaPublicConfig, isCaptchaConfigured, verifyCaptchaToken } from './captcha';

const fetchMock = vi.fn();

beforeEach(() => {
  delete secrets.captcha_site_key;
  delete secrets.captcha_secret_key;
  delete process.env.CAPTCHA_SITE_KEY;
  delete process.env.CAPTCHA_SECRET_KEY;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubSiteverify(payload: unknown, ok = true) {
  fetchMock.mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  });
}

describe('getCaptchaPublicConfig', () => {
  it('returns null when nothing is configured', async () => {
    await expect(getCaptchaPublicConfig()).resolves.toBeNull();
    await expect(isCaptchaConfigured()).resolves.toBe(false);
  });

  it('returns null when only the site key is configured', async () => {
    secrets.captcha_site_key = 'site-key';
    await expect(getCaptchaPublicConfig()).resolves.toBeNull();
  });

  it('returns the site key when both keys come from the secret provider', async () => {
    secrets.captcha_site_key = 'site-key';
    secrets.captcha_secret_key = 'secret-key';
    await expect(getCaptchaPublicConfig()).resolves.toEqual({ provider: 'turnstile', siteKey: 'site-key' });
  });

  it('falls back to environment variables', async () => {
    process.env.CAPTCHA_SITE_KEY = 'env-site-key';
    process.env.CAPTCHA_SECRET_KEY = 'env-secret-key';
    await expect(getCaptchaPublicConfig()).resolves.toEqual({ provider: 'turnstile', siteKey: 'env-site-key' });
  });
});

describe('verifyCaptchaToken', () => {
  beforeEach(() => {
    secrets.captcha_site_key = 'site-key';
    secrets.captcha_secret_key = 'secret-key';
  });

  it('accepts a token Cloudflare reports as valid and forwards the client IP', async () => {
    stubSiteverify({ success: true });
    await expect(verifyCaptchaToken('token-1', '203.0.113.9')).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('challenges.cloudflare.com/turnstile');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('secret')).toBe('secret-key');
    expect(body.get('response')).toBe('token-1');
    expect(body.get('remoteip')).toBe('203.0.113.9');
  });

  it('omits remoteip when the client IP is unknown', async () => {
    stubSiteverify({ success: true });
    await verifyCaptchaToken('token-2', 'unknown');
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1].body));
    expect(body.get('remoteip')).toBeNull();
  });

  it('rejects a token Cloudflare reports as invalid', async () => {
    stubSiteverify({ success: false, 'error-codes': ['invalid-input-response'] });
    await expect(verifyCaptchaToken('token-3', '203.0.113.9')).resolves.toBe(false);
  });

  it('fails closed on a non-OK response', async () => {
    stubSiteverify({}, false);
    await expect(verifyCaptchaToken('token-4', '203.0.113.9')).resolves.toBe(false);
  });

  it('fails closed when siteverify is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(verifyCaptchaToken('token-5', '203.0.113.9')).resolves.toBe(false);
  });

  it('rejects empty tokens without calling siteverify', async () => {
    await expect(verifyCaptchaToken('', '203.0.113.9')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects everything when no secret key is configured', async () => {
    delete secrets.captcha_secret_key;
    await expect(verifyCaptchaToken('token-6', '203.0.113.9')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
