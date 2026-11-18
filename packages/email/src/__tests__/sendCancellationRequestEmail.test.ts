import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock('../system/SystemEmailService', () => ({
  getSystemEmailService: async () => ({ sendEmail: mocks.sendEmail }),
}));

import { sendCancellationRequestEmail } from '../sendCancellationRequestEmail';

const data = {
  tenantName: 'Acme',
  recipientName: 'Acme',
  recipientEmail: 'owner@example.test',
  cancelAtDate: new Date('2026-09-01T00:00:00.000Z').toISOString(),
};

describe('sendCancellationRequestEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws with the provider error when sendEmail resolves { success: false }', async () => {
    mocks.sendEmail.mockResolvedValue({ success: false, error: 'SMTP connection refused' });

    await expect(sendCancellationRequestEmail(data)).rejects.toThrow('SMTP connection refused');
  });

  it('throws when sendEmail resolves { success: false } without an error message', async () => {
    mocks.sendEmail.mockResolvedValue({ success: false });

    await expect(sendCancellationRequestEmail(data)).rejects.toThrow('Failed to send cancellation request email');
  });

  it('propagates a rejected sendEmail', async () => {
    mocks.sendEmail.mockRejectedValue(new Error('sender invalid'));

    await expect(sendCancellationRequestEmail(data)).rejects.toThrow('sender invalid');
  });

  it('resolves when sendEmail resolves { success: true }', async () => {
    mocks.sendEmail.mockResolvedValue({ success: true });

    await expect(sendCancellationRequestEmail(data)).resolves.toBeUndefined();
  });
});
