import { describe, expect, it, vi } from 'vitest';
import { TenantEmailOutboundAdapter } from '../TenantEmailOutboundAdapter';

describe('TenantEmailOutboundAdapter', () => {
  it('hands rendered email to the tenant transport with ticket board routing', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true, messageId: 'smtp-42' });
    const adapter = new TenantEmailOutboundAdapter(() => ({ sendEmail } as never));

    await expect(adapter.send({
      tenantId: 'tenant-1',
      to: 'manager@example.test',
      subject: 'Escalation',
      html: '<p>Ticket T-42</p>',
      text: 'Ticket T-42',
      mailClass: 'ticket',
      boardId: 'board-42',
      userId: 'manager-1',
    })).resolves.toEqual({ status: 'sent', messageId: 'smtp-42' });

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      to: 'manager@example.test',
      mailClass: 'ticket',
      boardId: 'board-42',
      userId: 'manager-1',
    }));
    const [params] = sendEmail.mock.calls[0];
    await expect(params.templateProcessor.process({})).resolves.toEqual({
      subject: 'Escalation', html: '<p>Ticket T-42</p>', text: 'Ticket T-42',
    });
  });

  it('preserves the transport retryability signal on failure', async () => {
    const smtpError = Object.assign(new Error('SMTP unavailable'), { isRetryable: true });
    const adapter = new TenantEmailOutboundAdapter(() => ({
      sendEmail: vi.fn().mockRejectedValue(smtpError),
    } as never));
    await expect(adapter.send({ tenantId: 't', to: 'x@y.test', subject: '', html: '', text: '', mailClass: 'ticket' }))
      .resolves.toEqual({ status: 'failed', reason: 'SMTP unavailable', retryable: true });
  });
});
