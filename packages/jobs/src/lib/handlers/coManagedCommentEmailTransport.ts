import { resolveCoManagedRequesterEmailRouting, resolveCoManagedTicketEmailMailbox } from './coManagedRequesterEmailRouting';
import type { CoManagedEmailDelivery, CoManagedCustomerEmailDelivery, CoManagedRequesterEmailDelivery, CoManagedRequesterTaskEmailDelivery, CoManagedEmailDeliveryResult, CoManagedTaskCommentNotification, CoManagedTicketCommentNotification } from '@alga-psa/co-managed';
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
const TASK_COPY: Record<string, { subject: string; open: string }> = {
  en: { subject: 'New comment on a task', open: 'Open task' },
  fr: { subject: 'Nouveau commentaire sur une tâche', open: 'Ouvrir la tâche' },
  de: { subject: 'Neuer Kommentar zu einer Aufgabe', open: 'Aufgabe öffnen' },
  es: { subject: 'Nuevo comentario en una tarea', open: 'Abrir tarea' },
  it: { subject: 'Nuovo commento su un’attività', open: 'Apri attività' },
  nl: { subject: 'Nieuwe reactie op een taak', open: 'Taak openen' },
  pl: { subject: 'Nowy komentarz do zadania', open: 'Otwórz zadanie' },
  pt: { subject: 'Novo comentário em uma tarefa', open: 'Abrir tarefa' },
  xx: { subject: '[Ñéŵ çômméñţ ôñ å ţåšķ]', open: '[Öpéñ ţåšķ]' },
  yy: { subject: '[New comment on a task]', open: '[Open task]' },
};
/** Worker-safe transport uses only the authority-filtered message supplied by
 * the queue. Its qualified link never impersonates a home-tenant ticket. */
export async function sendCoManagedCommentEmail(delivery: CoManagedEmailDelivery): Promise<CoManagedEmailDeliveryResult> {
  const source = delivery.message.resource;
  if (source.kind === 'project_task') {
    const message = delivery.message as CoManagedTaskCommentNotification;
    return sendAuthorizedCommentEmail(delivery, message.ownerTaskPath ?? `/msp/co-management/tasks/${source.tenant}/${source.relationshipId}/${source.id}`, 'subject');
  }
  return sendAuthorizedCommentEmail(delivery, `/msp/co-management/tickets/${source.tenant}/${source.relationshipId}/${source.id}`, 'subject');
}
export async function sendCoManagedCustomerCommentEmail(delivery: CoManagedCustomerEmailDelivery): Promise<CoManagedEmailDeliveryResult> {
  if (!/^cm2:[A-Za-z0-9_-]{43}$/.test(delivery.replyToken)) throw new Error('Invalid customer technician reply token');
  const routing = await resolveCoManagedTicketEmailMailbox(delivery.tenant, delivery.message.resource.id);
  return sendAuthorizedCommentEmail(delivery, `/msp/tickets/${delivery.message.resource.id}`, 'customerSubject', routing);
}
export async function sendCoManagedRequesterCommentEmail(delivery: CoManagedRequesterEmailDelivery | CoManagedRequesterTaskEmailDelivery): Promise<CoManagedEmailDeliveryResult> {
  if (!('replyToken' in delivery)) {
    if (delivery.recipient.kind !== 'requester_task_user' || delivery.message.resource.kind !== 'project_task') throw new Error('Invalid requester task delivery');
    return sendAuthorizedCommentEmail(delivery, `/client-portal/projects/${delivery.message.projectId}?taskId=${delivery.message.resource.id}`, 'customerSubject');
  }
  if (!/^cm1:[A-Za-z0-9_-]{43}$/.test(delivery.replyToken)) throw new Error('Invalid requester reply token');
  const routing = await resolveCoManagedRequesterEmailRouting(delivery);
  return sendAuthorizedCommentEmail(delivery, routing.url, 'customerSubject', routing);
}
/** Delivery adapters supply only current, admitted content and their own
 * navigation target. Rendering and caller-owned transport completion are shared. */
async function sendAuthorizedCommentEmail(delivery: CoManagedEmailDelivery | CoManagedCustomerEmailDelivery | CoManagedRequesterEmailDelivery | CoManagedRequesterTaskEmailDelivery, path: string,
  subjectKey: 'subject' | 'customerSubject', routing?: { from?: { email: string; name?: string }; replyTo?: { email: string; name?: string } }): Promise<CoManagedEmailDeliveryResult> {
  const requester = 'recipient' in delivery;
  const locale = await resolveEmailLocale(delivery.tenant, requester
    ? { email: delivery.email, clientId: delivery.recipient.clientId, userType: 'client',
      ...(delivery.recipient.kind === 'requester_task_user' ? { userId: delivery.recipient.userId } : {}) }
    : { email: delivery.email, userId: delivery.recipientUserId, userType: 'internal' });
  const task = delivery.message.resource.kind === 'project_task';
  const taskCopy = TASK_COPY[locale] ?? TASK_COPY[locale.split('-')[0]] ?? TASK_COPY.en;
  const copy = task ? { ...taskCopy, customerSubject: taskCopy.subject } : COPY[locale] ?? COPY[locale.split('-')[0]] ?? COPY.en;
  const base = new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000');
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Invalid email application URL');
  const { message } = delivery;
  const url = new URL(path, base.origin).toString();
  const subject = copy[subjectKey];
  const title = (task ? [(message as CoManagedTaskCommentNotification).taskName, (message as CoManagedTaskCommentNotification).projectName]
    : [(message as CoManagedTicketCommentNotification).ticketNumber, (message as CoManagedTicketCommentNotification).ticketTitle]).filter(Boolean).join(' — ');
  const author = message.author?.displayName ? [message.author.displayName, message.author.organizationName].filter(Boolean).join(' — ') : '—';
  const body = extractTicketRichTextPlainText(message.note);
  let html = `<h2>${escape(subject)}</h2>${title ? `<p>${escape(title)}</p>` : ''}<p>${escape(author)}</p><div style="white-space:pre-wrap">${escape(body)}</div><p><a href="${escape(url)}">${escape(copy.open)}</a></p>`;
  let text = [subject, title, author, body, `${copy.open}: ${url}`].filter(Boolean).join('\n\n');
  if ('replyToken' in delivery) {
    html = `<div data-alga-reply-boundary="true"></div>${html}<div style="display:none" data-alga-reply-token="${delivery.replyToken}"></div>`;
    text = `--- Please reply above this line ---\n\n${text}\n\n[ALGA-REPLY-TOKEN ${delivery.replyToken}]`;
  }
  const result = await TenantEmailService.getInstance(delivery.tenant).sendEmail({ tenantId: delivery.tenant, to: delivery.email,
    userId: requester ? (delivery.recipient.kind === 'requester_task_user' ? delivery.recipient.userId : undefined) : delivery.recipientUserId, from: routing?.from, replyTo: routing?.replyTo, notificationSubtypeId: delivery.subtypeId, locale, retryPolicy: 'caller',
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
