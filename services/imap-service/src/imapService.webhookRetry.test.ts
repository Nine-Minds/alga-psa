import { describe, expect, it, vi } from 'vitest';
import { dispatchImapInboundWebhookWithRetry } from './imapService';

const axiosPostMock = vi.fn();

vi.mock('axios', () => ({
  default: {
    post: (...args: any[]) => axiosPostMock(...args),
  },
}));

describe('IMAP webhook retry behavior', () => {
  it('T008: retries webhook delivery when ingress responds with non-2xx before succeeding', async () => {
    axiosPostMock.mockReset();
    const sleepMock = vi.fn(async () => undefined);

    axiosPostMock
      .mockResolvedValueOnce({ status: 503, data: { error: 'temporary_failure' } })
      .mockResolvedValueOnce({ status: 200, data: { success: true } });

    await dispatchImapInboundWebhookWithRetry({
      url: 'http://localhost:3000/api/email/webhooks/imap',
      timeoutMs: 1000,
      maxAttempts: 3,
      payload: {
        providerId: 'provider-imap-1',
        tenantId: 'tenant-1',
        pointer: {
          mailbox: 'INBOX',
          uid: '1001',
        },
      },
      headers: {
        'x-imap-webhook-secret': 'imap-secret',
      },
      providerId: 'provider-imap-1',
      tenant: 'tenant-1',
      folder: 'INBOX',
      listenerId: 'listener-test-1',
      retryBaseMs: 1,
      jitterPct: 0,
      sleepFn: sleepMock,
    });

    expect(axiosPostMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(axiosPostMock.mock.calls[0][0]).toBe('http://localhost:3000/api/email/webhooks/imap');
    expect(axiosPostMock.mock.calls[0][1]).toMatchObject({
      providerId: 'provider-imap-1',
      tenantId: 'tenant-1',
      pointer: {
        mailbox: 'INBOX',
        uid: '1001',
      },
    });
  });
});
