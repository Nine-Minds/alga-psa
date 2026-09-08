import type { CoManagedWorkflowTicketEmail, CoManagedEmailDeliveryResult } from '@alga-psa/co-managed';
import { TenantEmailService, StaticTemplateProcessor } from '@alga-psa/email';
import { AUTO_GENERATED_MAIL_HEADERS } from '@alga-psa/shared/lib/email/automatedMessage';

/** The durable command owns retries; the generic queue must not retain an
 * address/body that bypasses current workflow and requester admission. */
export async function sendCoManagedWorkflowTicketEmail(delivery: CoManagedWorkflowTicketEmail): Promise<CoManagedEmailDeliveryResult> {
  const result = await TenantEmailService.getInstance(delivery.tenant).sendEmail({ tenantId: delivery.tenant,
    to: delivery.email, notificationSubtypeId: delivery.subtypeId, retryPolicy: 'caller',
    templateProcessor: new StaticTemplateProcessor(delivery.subject, delivery.html, delivery.text),
    headers: { ...AUTO_GENERATED_MAIL_HEADERS, 'Message-ID': delivery.messageId },
  });
  if (result.success && !result.queued) return { status: 'delivered' };
  if (result.queued) return { status: 'failed', retryable: false, errorCode: 'unexpected_generic_email_queue' };
  return { status: 'failed', retryable: result.metadata?.retryable !== false, errorCode: 'email_provider_failed', retryAfterMs: result.metadata?.retryAfterMs };
}
