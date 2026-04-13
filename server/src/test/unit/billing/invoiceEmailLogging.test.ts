import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage } from '@alga-psa/types';

const {
  buildFailedProviderResultMock,
  writeEmailSendResultLogMock,
} = vi.hoisted(() => ({
  buildFailedProviderResultMock: vi.fn(),
  writeEmailSendResultLogMock: vi.fn(),
}));

vi.mock('@alga-psa/email', () => ({
  buildFailedProviderResult: buildFailedProviderResultMock,
  writeEmailSendResultLog: writeEmailSendResultLogMock,
}));

const message: EmailMessage = {
  from: { email: 'billing@example.com', name: 'Acme MSP' },
  to: [{ email: 'client@example.com', name: 'Client Co' }],
  subject: 'Invoice INV-1001 from Acme MSP',
  html: '<p>Invoice attached</p>',
  text: 'Invoice attached',
};

describe('invoiceEmailLogging helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildFailedProviderResultMock.mockImplementation(({ providerId, providerType, error }: any) => ({
      success: false,
      messageId: undefined,
      providerId,
      providerType,
      error: error instanceof Error ? error.message : String(error),
      metadata: { error: error instanceof Error ? error.message : String(error) },
      sentAt: new Date('2026-03-15T01:00:00.000Z'),
    }));
  });

  it('logs successful invoice provider results through the shared email log writer', async () => {
    const { logInvoiceEmailSendResult } = await import('../../../../../packages/billing/src/actions/invoiceEmailLogging');

    logInvoiceEmailSendResult('tenant-1', message, {
      success: true,
      messageId: 'provider-msg-1',
      providerId: 'system-provider',
      providerType: 'smtp',
      sentAt: new Date('2026-03-15T01:00:00.000Z'),
    });

    expect(writeEmailSendResultLogMock).toHaveBeenCalledWith({
      serviceName: 'sendInvoiceEmailAction',
      tenantId: 'tenant-1',
      providerResult: expect.objectContaining({
        success: true,
        messageId: 'provider-msg-1',
      }),
      message,
    });
  });

  it('normalizes invoice send failures before logging them through the shared writer', async () => {
    const { logInvoiceEmailSendFailure } = await import('../../../../../packages/billing/src/actions/invoiceEmailLogging');
    const error = new Error('SMTP exploded');

    logInvoiceEmailSendFailure('tenant-1', message, {
      providerId: 'system-provider',
      providerType: 'smtp',
    }, error);

    expect(buildFailedProviderResultMock).toHaveBeenCalledWith({
      providerId: 'system-provider',
      providerType: 'smtp',
      error,
    });
    expect(writeEmailSendResultLogMock).toHaveBeenCalledWith({
      serviceName: 'sendInvoiceEmailAction',
      tenantId: 'tenant-1',
      providerResult: expect.objectContaining({
        success: false,
        error: 'SMTP exploded',
      }),
      message,
    });
  });
});
