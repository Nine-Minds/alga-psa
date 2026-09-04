import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(),
}));

import { GmailAdapter } from '@alga-psa/shared/services/email/providers/GmailAdapter';

const dummySecret = 'gmail-dummy-client-secret-not-for-logs';

function gmailProviderConfig(): EmailProviderConfig {
  return {
    id: 'provider-gmail-hygiene',
    tenant: 'tenant-gmail-hygiene',
    name: 'Gmail hygiene',
    provider_type: 'google',
    mailbox: 'inbox@example.com',
    folder_to_monitor: 'Inbox',
    active: true,
    webhook_notification_url: '',
    connection_status: 'connected',
    provider_config: {
      client_id: 'gmail-client-id',
      client_secret: dummySecret,
      pubsub_topic_name: 'projects/project/topics/topic',
      project_id: 'project',
    },
  } as EmailProviderConfig;
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  vi.restoreAllMocks();
});

describe('Gmail adapter log hygiene', () => {
  it('does not print provider_config (which carries client_secret) while setting up a webhook subscription', async () => {
    const adapter = new GmailAdapter(gmailProviderConfig());

    await expect(adapter.registerWebhookSubscription()).rejects.toThrow('Gmail OAuth tokens are missing');

    const captured = [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .flatMap((call) => call.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))))
      .join(' ');
    expect(captured).not.toContain(dummySecret);
    expect(captured).not.toContain('client_secret');
  });
});
