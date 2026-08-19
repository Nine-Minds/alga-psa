/**
 * The audience Google signs a push token with and the audience the webhook
 * route checks it against are the same string or delivery silently 401s.
 * These tests pin the normalization rules that keep them the same string.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAppSecretMock = vi.fn(async (_key: string) => undefined as string | undefined);

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: (key: string) => getAppSecretMock(key),
  }),
}));

import {
  GOOGLE_WEBHOOK_PATH,
  GmailPubSubConfigurationError,
  buildGmailWebhookUrl,
  describeUnreachableGmailBaseUrl,
  getGmailPubSubNames,
  normalizeGmailBaseUrl,
  requireGmailWebhookBaseUrl,
  resolveGmailWebhookBaseUrl,
} from './gmailPubSub';

const BASE_URL_ENV = ['NGROK_URL', 'NEXT_PUBLIC_BASE_URL', 'NEXTAUTH_URL', 'PUBLIC_WEBHOOK_BASE_URL'];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of BASE_URL_ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  getAppSecretMock.mockReset();
  getAppSecretMock.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const key of BASE_URL_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('normalizeGmailBaseUrl', () => {
  it.each([
    ['https://alga.example.com/', 'https://alga.example.com'],
    ['https://alga.example.com///', 'https://alga.example.com'],
    ['HTTPS://ALGA.EXAMPLE.COM', 'https://alga.example.com'],
    ['https://alga.example.com:443', 'https://alga.example.com'],
    ['http://alga.example.com:80', 'http://alga.example.com'],
    ['  https://alga.example.com  ', 'https://alga.example.com'],
    ['https://alga.example.com?x=1#frag', 'https://alga.example.com'],
  ])('collapses %s to %s', (input, expected) => {
    expect(normalizeGmailBaseUrl(input)).toBe(expected);
  });

  it('keeps a non-default port', () => {
    expect(normalizeGmailBaseUrl('https://alga.example.com:8443/')).toBe('https://alga.example.com:8443');
  });

  it('preserves a path prefix so both sides agree on it', () => {
    expect(normalizeGmailBaseUrl('https://example.com/alga/')).toBe('https://example.com/alga');
  });

  it.each(['', 'not-a-url', 'alga.example.com', 'ftp://alga.example.com'])(
    'rejects %s rather than guessing',
    (input) => {
      expect(() => normalizeGmailBaseUrl(input)).toThrow(GmailPubSubConfigurationError);
    }
  );
});

describe('buildGmailWebhookUrl', () => {
  it('produces the same string from the base URL and from the request path', () => {
    const fromProvisioning = buildGmailWebhookUrl('https://alga.example.com/');
    const fromVerification = buildGmailWebhookUrl('HTTPS://alga.example.com:443', GOOGLE_WEBHOOK_PATH);
    expect(fromProvisioning).toBe('https://alga.example.com/api/email/webhooks/google');
    expect(fromVerification).toBe(fromProvisioning);
  });
});

describe('describeUnreachableGmailBaseUrl', () => {
  it.each([
    'http://alga.example.com',
    'https://localhost',
    'https://127.0.0.1',
    'https://10.1.2.3',
    'https://192.168.1.5',
    'https://172.20.0.4',
    'https://alga.local',
    'https://alga-server',
  ])('flags %s as unreachable by Pub/Sub push', (url) => {
    expect(describeUnreachableGmailBaseUrl(url)).toBeTruthy();
  });

  it('accepts a public HTTPS address', () => {
    expect(describeUnreachableGmailBaseUrl('https://alga.example.com')).toBeNull();
  });

  it('accepts an ngrok tunnel', () => {
    expect(describeUnreachableGmailBaseUrl('https://abc123.ngrok-free.app')).toBeNull();
  });
});

describe('resolveGmailWebhookBaseUrl', () => {
  it('prefers NGROK_URL over every other source', async () => {
    process.env.NGROK_URL = 'https://tunnel.ngrok-free.app';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://public.example.com';
    process.env.NEXTAUTH_URL = 'https://auth.example.com';

    await expect(resolveGmailWebhookBaseUrl()).resolves.toEqual({
      baseUrl: 'https://tunnel.ngrok-free.app',
      source: 'NGROK_URL',
    });
  });

  it('prefers NEXT_PUBLIC_BASE_URL over NEXTAUTH_URL', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://public.example.com';
    process.env.NEXTAUTH_URL = 'https://auth.example.com';

    await expect(resolveGmailWebhookBaseUrl()).resolves.toEqual({
      baseUrl: 'https://public.example.com',
      source: 'NEXT_PUBLIC_BASE_URL',
    });
  });

  it('reads the same key from app secrets when the environment is silent', async () => {
    getAppSecretMock.mockImplementation(async (key: string) =>
      key === 'NEXT_PUBLIC_BASE_URL' ? 'https://secret.example.com/' : undefined
    );

    await expect(resolveGmailWebhookBaseUrl()).resolves.toEqual({
      baseUrl: 'https://secret.example.com',
      source: 'NEXT_PUBLIC_BASE_URL (app secret)',
    });
  });

  it('returns null when nothing is configured', async () => {
    await expect(resolveGmailWebhookBaseUrl()).resolves.toBeNull();
  });
});

describe('requireGmailWebhookBaseUrl', () => {
  it('refuses to fall back to localhost', async () => {
    await expect(requireGmailWebhookBaseUrl()).rejects.toThrow(/No base URL is configured/);
  });

  it('refuses an address Google cannot push to', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';
    await expect(requireGmailWebhookBaseUrl()).rejects.toThrow(/publicly reachable HTTPS endpoint/);
  });
});

describe('getGmailPubSubNames', () => {
  it('derives every name and the push audience from one place', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://alga.example.com/';

    await expect(getGmailPubSubNames('tenant-1')).resolves.toEqual({
      baseUrl: 'https://alga.example.com',
      source: 'NEXT_PUBLIC_BASE_URL',
      topicName: 'gmail-notifications-tenant-1',
      subscriptionName: 'gmail-webhook-tenant-1',
      webhookUrl: 'https://alga.example.com/api/email/webhooks/google',
    });
  });

  it('fails loudly on a localhost instance instead of provisioning a dead subscription', async () => {
    process.env.NEXTAUTH_URL = 'http://localhost:3000';
    await expect(getGmailPubSubNames('tenant-1')).rejects.toThrow(GmailPubSubConfigurationError);
  });
});
