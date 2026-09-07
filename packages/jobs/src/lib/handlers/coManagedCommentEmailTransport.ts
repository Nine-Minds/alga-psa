import type { CoManagedEmailDelivery, CoManagedCustomerEmailDelivery, CoManagedEmailDeliveryResult } from '@alga-psa/co-managed';
import { TenantEmailService, StaticTemplateProcessor } from '@alga-psa/email';
import { resolveEmailLocale } from '@alga-psa/notifications/notifications/emailLocaleResolver';
import { extractTicketRichTextPlainText } from '@alga-psa/tickets/lib/ticketRichText';
import { AUTO_GENERATED_MAIL_HEADERS } from '@alga-psa/shared/lib/email/automatedMessage';

const COPY: Record<string, { subject: string; customerSubject: string; open: string }> = {
  en: { customerSubject: 'New comment on a ticket', subject: 'New comment on a shared ticket', open: 'Open ticket' },
  fr: { customerSubject: 'Nouveau commentaire sur un ticket', subject: 'Nouveau commentaire sur un ticket partagé', open: 'Ouvrir le ticket' },
  de: { customerSubject: 'Neuer Kommentar zu einem Ticket', subject: 'Neuer Kommentar zu einem geteilten Ticket', open: 'Ticket öffnen' },
  es: { customerSubject: 'Nuevo comentario en un ticket', subject: 'Nuevo comentario en un ticket compartido', open: 'Abrir ticket' },
  it: { customerSubject: 'Nuovo commento su un ticket', subject: 'Nuovo commento su un ticket condiviso', open: 'Apri ticket' },
  nl: { customerSubject: 'Nieuwe reactie op een ticket', subject: 'Nieuwe reactie op een gedeeld ticket', open: 'Ticket openen' },
  pl: { customerSubject: 'Nowy komentarz do zgłoszenia', subject: 'Nowy komentarz do udostępnionego zgłoszenia', open: 'Otwórz zgłoszenie' },
  pt: { customerSubject: 'Novo comentário em um chamado', subject: 'Novo comentário em um chamado compartilhado', open: 'Abrir chamado' },
  xx: { customerSubject: '[Ñéŵ çômméñţ ôñ å ţïçķéţ]', subject: '[Ñéŵ çômméñţ ôñ å šhåŕéđ ţïçķéţ]', open: '[Öpéñ ţïçķéţ]' },
  yy: { customerSubject: '[New comment on a ticket]', subject: '[New comment on a shared ticket]', open: '[Open ticket]' },
};
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
/** Worker-safe transport uses only the authority-filtered message supplied by
 * the queue. Its qualified link never impersonates a home-tenant ticket. */
export async function sendCoManagedCommentEmail(delivery: CoManagedEmailDelivery): Promise<CoManagedEmailDeliveryResult> {
  const source = delivery.message.resource;
  return sendAuthorizedCommentEmail(delivery, `/msp/co-management/tickets/${source.tenant}/${source.relationshipId}/${source.id}`, 'subject');
}
export async function sendCoManagedCustomerCommentEmail(delivery: CoManagedCustomerEmailDelivery): Promise<CoManagedEmailDeliveryResult> {
  return sendAuthorizedCommentEmail(delivery, `/msp/tickets/${delivery.message.resource.id}`, 'customerSubject');
}
/** Both delivery adapters supply only current, admitted content and their own
 * navigation target. Rendering and caller-owned transport completion are shared. */
async function sendAuthorizedCommentEmail(delivery: CoManagedEmailDelivery | CoManagedCustomerEmailDelivery, path: string,
  subjectKey: 'subject' | 'customerSubject'): Promise<CoManagedEmailDeliveryResult> {
  const locale = await resolveEmailLocale(delivery.tenant, { email: delivery.email, userId: delivery.recipientUserId, userType: 'internal' });
  const copy = COPY[locale] ?? COPY[locale.split('-')[0]] ?? COPY.en;
  const base = new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000');
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Invalid email application URL');
  const { message } = delivery;
  const url = new URL(path, base.origin).toString();
  const subject = copy[subjectKey];
  const title = [message.ticketNumber, message.ticketTitle].filter(Boolean).join(' — ');
  const author = message.author?.displayName ? [message.author.displayName, message.author.organizationName].filter(Boolean).join(' — ') : '—';
  const body = extractTicketRichTextPlainText(message.note);
  const html = `<h2>${escape(subject)}</h2>${title ? `<p>${escape(title)}</p>` : ''}<p>${escape(author)}</p><div style="white-space:pre-wrap">${escape(body)}</div><p><a href="${escape(url)}">${escape(copy.open)}</a></p>`;
  const text = [subject, title, author, body, `${copy.open}: ${url}`].filter(Boolean).join('\n\n');
  const result = await TenantEmailService.getInstance(delivery.tenant).sendEmail({ tenantId: delivery.tenant, to: delivery.email,
    userId: delivery.recipientUserId, notificationSubtypeId: delivery.subtypeId, locale, retryPolicy: 'caller',
    templateProcessor: new StaticTemplateProcessor(subject, html, text),
    headers: { ...AUTO_GENERATED_MAIL_HEADERS, 'Message-ID': delivery.messageId },
  });
  if (result.success && !result.queued) return { status: 'delivered' };
  if (result.queued) return { status: 'failed', retryable: false, errorCode: 'unexpected_generic_email_queue' };
  // Unconfigured transport remains retryable; a queue entry must not masquerade
  // as a delivered recipient simply because no provider was available yet.
  return { status: 'failed', retryable: result.metadata?.retryable !== false,
    errorCode: 'email_provider_failed', retryAfterMs: result.metadata?.retryAfterMs };
}
