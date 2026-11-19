import { afterEach, expect, it, vi } from 'vitest';
import { getWebhookBaseUrl as serverCallbackBase } from '../../../utils/email/webhookHelpers';
import { getWebhookBaseUrl as providerCallbackBase } from '../../../../../packages/integrations/src/utils/email/webhookHelpers';
import { getEmailWebhookBaseUrl as workerCallbackBase } from '../../../../../shared/services/email/webhookBaseUrl';

afterEach(() => vi.unstubAllEnvs());

it('uses the public webhook origin for mailbox setup and renewal with an internal application URL', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('APP_ENV', 'production');
  vi.stubEnv('NGROK_URL', 'https://stale-tunnel.ngrok.test');
  vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', 'https://psa.customer.example');
  vi.stubEnv('APPLICATION_URL', 'http://alga-core.msp.svc.cluster.local:3000');
  expect([serverCallbackBase(), providerCallbackBase(), workerCallbackBase()])
    .toEqual(Array(3).fill('https://psa.customer.example'));
});

it('preserves a plain HTTP appliance URL so the worker can detect unsupported callbacks', () => {
  vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', 'http://192.168.1.50:3000/');
  expect(workerCallbackBase()).toBe('http://192.168.1.50:3000');
});

it('uses NGROK_URL only in development, ahead of the public webhook origin', () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('NGROK_URL', 'https://tunnel.example.test///');
  vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', 'https://public.example.test');
  vi.stubEnv('APPLICATION_URL', 'http://internal.example.test');
  expect([serverCallbackBase(), providerCallbackBase(), workerCallbackBase()])
    .toEqual(Array(3).fill('https://tunnel.example.test'));

  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('APP_ENV', 'production');
  vi.stubEnv('NGROK_URL', 'https://stale-tunnel.ngrok.test');
  vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', '');
  vi.stubEnv('APPLICATION_URL', '');
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://browser.example.test///');
  vi.stubEnv('NEXTAUTH_URL', 'https://auth.example.test');
  expect([serverCallbackBase(), providerCallbackBase(), workerCallbackBase()])
    .toEqual(Array(3).fill('https://browser.example.test'));
});

it('uses the hosted email fallback without changing the generic webhook fallback', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('APP_ENV', 'production');
  for (const name of ['NGROK_URL', 'PUBLIC_WEBHOOK_BASE_URL', 'APPLICATION_URL', 'NEXT_PUBLIC_BASE_URL', 'NEXTAUTH_URL']) {
    vi.stubEnv(name, '');
  }
  expect([serverCallbackBase(), providerCallbackBase(), workerCallbackBase()])
    .toEqual(['http://localhost:3000', 'http://localhost:3000', 'https://algapsa.com']);
  expect([
    serverCallbackBase(undefined, 'https://algapsa.com'),
    providerCallbackBase(undefined, 'https://algapsa.com'),
  ]).toEqual(['https://algapsa.com', 'https://algapsa.com']);
});

it('uses the configured application origin for mailbox setup and renewal when browser sign-in has another origin', () => {
  vi.stubEnv('NGROK_URL', '');
  vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', '');
  vi.stubEnv('APPLICATION_URL', 'https://mail-hooks.example.test');
  vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'http://localhost:3000');
  expect([serverCallbackBase(), providerCallbackBase(), workerCallbackBase()])
    .toEqual(Array(3).fill('https://mail-hooks.example.test'));
});

it('preserves explicit provider callback precedence for calendar subscriptions', () => {
  vi.stubEnv('APPLICATION_URL', 'https://application.example.test');
  vi.stubEnv('CALENDAR_MICROSOFT_WEBHOOK_BASE_URL', 'https://calendar.example.test');
  const order = ['CALENDAR_MICROSOFT_WEBHOOK_BASE_URL', 'APPLICATION_URL'];
  expect([serverCallbackBase(order), providerCallbackBase(order)])
    .toEqual(Array(2).fill('https://calendar.example.test'));
});
