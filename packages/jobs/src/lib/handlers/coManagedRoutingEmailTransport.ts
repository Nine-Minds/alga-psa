import type { CoManagedRoutingEmailDelivery, CoManagedEmailDeliveryResult } from '@alga-psa/co-managed';
import type { Knex } from 'knex';
import { getConnection } from '@alga-psa/db';
import { TenantEmailService, StaticTemplateProcessor } from '@alga-psa/email';
import { resolveEmailLocale } from '@alga-psa/notifications/notifications/emailLocaleResolver';
import { getNotificationTemplate, renderTemplate } from '@alga-psa/notifications/actions/internal-notification-actions/createNotificationCore';
import { coManagedRoutingPresentation } from '@alga-psa/notifications/lib/coManagedRoutingPresentation';
import { AUTO_GENERATED_MAIL_HEADERS } from '@alga-psa/shared/lib/email/automatedMessage';
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
/** Uses the same localized routing copy as the inbox and the existing ticket
 * assignment email preferences. Provider retry stays with the durable receipt. */
export async function sendCoManagedRoutingEmail(delivery: CoManagedRoutingEmailDelivery): Promise<CoManagedEmailDeliveryResult> {
  const locale = await resolveEmailLocale(delivery.tenant, { email: delivery.email, userId: delivery.recipientUserId, userType: 'internal' });
  const presentation = coManagedRoutingPresentation(delivery.message), db = await getConnection(delivery.tenant);
  const template = await getNotificationTemplate(db as Knex.Transaction, delivery.tenant, `co-managed-ticket-${delivery.message.transition}`, locale);
  if (!template) throw new Error('Routing notification template is missing');
  const base = new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Invalid routing notification application URL');
  const url = new URL(presentation.link, base.origin).toString(), text = renderTemplate(template.message, presentation.data);
  const result = await TenantEmailService.getInstance(delivery.tenant).sendEmail({ tenantId: delivery.tenant,
    to: delivery.email, userId: delivery.recipientUserId, notificationSubtypeId: delivery.subtypeId, locale, retryPolicy: 'caller',
    templateProcessor: new StaticTemplateProcessor(renderTemplate(template.title, presentation.data).replace(/[\r\n]+/g, ' '),
      `<p>${escape(text)}</p><p><a href="${escape(url)}">${escape(url)}</a></p>`, `${text}\n\n${url}`),
    headers: { ...AUTO_GENERATED_MAIL_HEADERS, 'Message-ID': delivery.messageId },
  });
  if (result.success && !result.queued) return { status: 'delivered' };
  if (result.queued) return { status: 'failed', retryable: false, errorCode: 'unexpected_generic_email_queue' };
  return { status: 'failed', retryable: result.metadata?.retryable !== false, errorCode: 'email_provider_failed', retryAfterMs: result.metadata?.retryAfterMs };
}
