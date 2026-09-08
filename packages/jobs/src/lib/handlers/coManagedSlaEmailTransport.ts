import type { CoManagedSlaEmailDelivery, CoManagedEmailDeliveryResult } from '@alga-psa/co-managed';
import { TenantEmailService, DatabaseTemplateProcessor, StaticTemplateProcessor } from '@alga-psa/email';
import { getConnection } from '@alga-psa/db';
import { resolveEmailLocale } from '@alga-psa/notifications/notifications/emailLocaleResolver';
import { coManagedSlaPresentation } from '@alga-psa/notifications/lib/coManagedSlaPresentation';
import { AUTO_GENERATED_MAIL_HEADERS } from '@alga-psa/shared/lib/email/automatedMessage';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
/** Load the existing tenant/system SLA template, then substitute admitted data
 * with context-appropriate escaping. The legacy generic processor substitutes
 * raw strings; no untrusted ticket title is passed through that substitution. */
export async function sendCoManagedSlaEmail(delivery: CoManagedSlaEmailDelivery): Promise<CoManagedEmailDeliveryResult> {
  const locale = await resolveEmailLocale(delivery.tenant, { email: delivery.email, userId: delivery.recipientUserId, userType: 'internal' });
  const base = new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Invalid SLA email application URL');
  const presentation = coManagedSlaPresentation(delivery.message);
  const template = await new DatabaseTemplateProcessor(await getConnection(delivery.tenant), `sla-${delivery.message.notificationType}`)
    .process({ tenantId: delivery.tenant, locale });
  const data: Record<string, unknown> = { ...presentation.data, recipientName: delivery.recipientName,
    ticketUrl: new URL(presentation.link, base.origin).toString() };
  // LEVERAGE: friction email-template-context-escaping — generic rendering needs distinct HTML and plain-text substitution.
  const render = (value: string, html = false) => value.replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g, (_match, key: string) => {
    const text = String(data[key] ?? ''); return html ? escape(text) : text;
  });
  const result = await TenantEmailService.getInstance(delivery.tenant).sendEmail({ tenantId: delivery.tenant,
    to: delivery.email, userId: delivery.recipientUserId, notificationSubtypeId: delivery.subtypeId, locale, retryPolicy: 'caller',
    templateProcessor: new StaticTemplateProcessor(render(template.subject).replace(/[\r\n]+/g, ' '), render(template.html, true), render(template.text)),
    headers: { ...AUTO_GENERATED_MAIL_HEADERS, 'Message-ID': delivery.messageId },
  });
  if (result.success && !result.queued) return { status: 'delivered' };
  if (result.queued) return { status: 'failed', retryable: false, errorCode: 'unexpected_generic_email_queue' };
  return { status: 'failed', retryable: result.metadata?.retryable !== false,
    errorCode: 'email_provider_failed', retryAfterMs: result.metadata?.retryAfterMs };
}
