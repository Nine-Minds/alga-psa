import { beforeEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ send: vi.fn(), tenant: vi.fn() }));
vi.mock('@alga-psa/email', () => ({
  TenantEmailService: { getInstance: (tenant: string) => { runtime.tenant(tenant); return { sendEmail: runtime.send }; } },
  StaticTemplateProcessor: class { constructor(private subject: string, private html: string, private text: string) {} async process() { return { subject: this.subject, html: this.html, text: this.text }; } },
}));
import { sendCoManagedWorkflowTicketEmail } from '@alga-psa/jobs/handlers/coManagedWorkflowTicketEmailTransport';
const delivery = { tenant: 'customer', email: 'current@example.test', contactId: 'requester', messageId: '<stable-workflow@notifications.alga.invalid>',
  subtypeId: 42, subject: 'Ticket closed', html: '<p>Fixed &lt;safe&gt;</p>', text: 'Fixed <safe>' };
beforeEach(() => { vi.clearAllMocks(); runtime.send.mockResolvedValue({ success: true }); });
it('sends only admitted closure content with caller-owned retries and stable message identity', async () => {
  expect(await sendCoManagedWorkflowTicketEmail(delivery)).toEqual({ status: 'delivered' });
  expect(runtime.tenant).toHaveBeenCalledWith('customer');
  const params = runtime.send.mock.calls[0][0];
  expect(params).toMatchObject({ tenantId: 'customer', to: delivery.email, notificationSubtypeId: 42, retryPolicy: 'caller', headers: { 'Message-ID': delivery.messageId } });
  expect(await params.templateProcessor.process()).toEqual({ subject: delivery.subject, html: delivery.html, text: delivery.text });
  expect(params.templateData).toBeUndefined();
});
it.each([
  [{ success: false, metadata: { retryable: true, retryAfterMs: 90000 } }, { status: 'failed', retryable: true, errorCode: 'email_provider_failed', retryAfterMs: 90000 }],
  [{ success: false, metadata: { retryable: false } }, { status: 'failed', retryable: false, errorCode: 'email_provider_failed', retryAfterMs: undefined }],
  [{ success: true, queued: true }, { status: 'failed', retryable: false, errorCode: 'unexpected_generic_email_queue' }],
])('returns provider completion to the durable workflow queue (%j)', async (provider, result) => {
  runtime.send.mockResolvedValue(provider); expect(await sendCoManagedWorkflowTicketEmail(delivery)).toEqual(result);
});
