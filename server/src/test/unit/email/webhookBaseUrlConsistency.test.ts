import { afterEach, expect, it, vi } from 'vitest';
import { getWebhookBaseUrl as serverCallbackBase } from '../../../utils/email/webhookHelpers';
import { getWebhookBaseUrl as providerCallbackBase } from '../../../../../packages/integrations/src/utils/email/webhookHelpers';
import { getEmailWebhookBaseUrl as workerCallbackBase } from '../../../../../shared/services/email/webhookBaseUrl';

afterEach(() => vi.unstubAllEnvs());

it('uses the configured application origin for mailbox setup and renewal when browser sign-in has another origin', () => {
  vi.stubEnv('NGROK_URL', '');
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
