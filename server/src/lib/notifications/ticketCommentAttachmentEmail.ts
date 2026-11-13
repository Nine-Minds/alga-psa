import type { Knex } from 'knex';
import { tenantDb, runWithTenant, withTransaction } from '@alga-psa/db';
import { authorizeAndRedactDocuments } from '@alga-psa/documents/actions/documentActions';
import { hasPermission } from '@/lib/auth/rbac';
import { StorageService } from '@alga-psa/storage/StorageService';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import logger from '@alga-psa/core/logger';
import { formatBlockNoteContent, type RichTextRenderOptions } from '@alga-psa/formatting/blocknoteUtils';
import { isInteractiveUserType } from '@alga-psa/types';
import { claimDelivery, finishDelivery, COMMENT_EMAIL_LEDGER } from '@shared/lib/deliveryLedger';
import { signAttachmentLink } from '@shared/lib/ticketCommentAttachmentToken';
import { listPublishedCommentAttachments, canAccessAttachmentTicket, isPublicAttachmentComment } from '@shared/lib/ticketCommentAttachments';
import type { EmailAttachment } from '../../types/email.types';
import {
  redactTicketEmailRenderedContent,
  redactTicketEmailStructuredContent,
  referencedDocumentFileId,
  isImageFile,
} from './ticketEmailContentPolicy';

export async function attachmentSigningSecret(): Promise<string> {
  const provider = await getSecretProviderInstance();
  const secret = await provider.getAppSecret('NEXTAUTH_SECRET') || await provider.getAppSecret('nextauth_secret');
  if (!secret) throw new Error('Attachment link signing secret is missing');
  return secret;
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));

/** The caller has resolved the notification audience. Recheck client membership on retry. */
export async function recipientCanReceiveCommentFiles(db: Knex, tenant: string, ticketId: string, recipient: string): Promise<boolean> {
  const scoped = tenantDb(db, tenant);
  const ticket = await scoped.table('tickets').where({ ticket_id: ticketId }).first();
  if (!ticket) return false;
  const users = await scoped.table('users').whereRaw('lower(email) = ?', [recipient.trim().toLowerCase()]);
  for (const user of users) {
    if (!user.is_inactive && await canAccessAttachmentTicket(db, tenant, user.user_id, ticketId)) return true;
  }
  // Existing accounts must satisfy their current access policy, even if the
  // same mailbox also belongs to a guest contact or default client location.
  if (users.length) return false;
  const contact = await scoped.table('contacts').where({ client_id: ticket.client_id }).whereRaw('lower(email) = ?', [recipient.toLowerCase()]).first();
  if (contact) {
    if (!contact.portal_visibility_group_id) return true;
    const group = await scoped.table('client_portal_visibility_groups').where({ group_id: contact.portal_visibility_group_id, client_id: ticket.client_id }).first();
    return Boolean(group && await scoped.table('client_portal_visibility_group_boards').where({ group_id: group.group_id, board_id: ticket.board_id }).first());
  }
  // Ticket notifications use the default active location when no contact is set.
  const location = await scoped.table('client_locations')
    .where({ client_id: ticket.client_id, is_default: true, is_active: true })
    .whereRaw('lower(email) = ?', [recipient.toLowerCase()]).first();
  return Boolean(location);
}

export async function recipientCanReceiveInternalComment(
  db: Knex, tenant: string, ticketId: string, recipient: string,
): Promise<boolean> {
  const users = await tenantDb(db, tenant).table('users')
    .where({ user_type: 'internal', is_inactive: false })
    .whereRaw('lower(email) = ?', [recipient.trim().toLowerCase()]);
  for (const user of users) {
    if (await canAccessAttachmentTicket(db, tenant, user.user_id, ticketId)) return true;
  }
  return false;
}

export async function classifyTicketEmailRecipient(
  db: Knex, tenant: string, ticketId: string, recipient: string,
): Promise<'internal' | 'external' | 'unknown'> {
  const users = await tenantDb(db, tenant).table('users')
    .whereRaw('lower(email) = ?', [recipient.trim().toLowerCase()]);
  if (users.some(user => user.is_inactive !== false ||
    !isInteractiveUserType(user.user_type))) return 'unknown';
  const types = new Set(users.map(user => user.user_type));
  if (types.size > 1) return 'unknown';
  if (types.has('internal')) {
    const scoped = tenantDb(db, tenant);
    const [contact, location] = await Promise.all([
      scoped.table('contacts').whereRaw('lower(email) = ?', [recipient.trim().toLowerCase()]).first(),
      scoped.table('client_locations').whereRaw('lower(email) = ?', [recipient.trim().toLowerCase()]).first(),
    ]);
    if (contact || location) return 'unknown';
    return await recipientCanReceiveInternalComment(db, tenant, ticketId, recipient) ? 'internal' : 'unknown';
  }
  return await recipientCanReceiveCommentFiles(db, tenant, ticketId, recipient) ? 'external' : 'unknown';
}

async function authorizeTicketDocument(
  trx: Knex.Transaction, tenant: string, ticketId: string, documentId: string, recipient: string, internalOnly: boolean,
) {
  const scoped = tenantDb(trx, tenant);
  if (!await recipientCanReceiveCommentFiles(trx, tenant, ticketId, recipient)) return null;
  const document = await scoped.table('documents').where({ document_id: documentId }).first();
  if (!document) return null;
  const ticket = await scoped.table('tickets').where({ ticket_id: ticketId }).first();
  const users = await scoped.table('users').whereRaw('lower(email) = ?', [recipient.trim().toLowerCase()]);
  // An existing disabled/restricted account cannot fall through to guest access.
  for (const user of users) {
    if ((internalOnly && user.user_type !== 'internal') || user.is_inactive ||
      !await canAccessAttachmentTicket(trx, tenant, user.user_id, ticketId) ||
      !await hasPermission({ ...user, tenant }, 'document', 'read', trx)) continue;
    if (user.user_type === 'client' && !document.is_client_visible) continue;
    const [allowed] = await authorizeAndRedactDocuments(trx, tenant, {
      ...user, clientId: user.user_type === 'client' ? ticket.client_id : undefined,
    }, [document]);
    if (allowed) return allowed;
  }
  if (internalOnly || users.length || !document.is_client_visible) return null;
  const contact = await scoped.table('contacts').where({ client_id: ticket.client_id })
    .whereRaw('lower(email) = ?', [recipient.trim().toLowerCase()]).first();
  // The verified mailbox is an explicit recipient grant, not an impersonated account.
  const principal = { tenant, user_id: contact?.contact_name_id || ticket.client_id, user_type: 'client',
    clientId: ticket.client_id, email: recipient, is_inactive: false } as any;
  const [allowed] = await authorizeAndRedactDocuments(trx, tenant, principal, [document], async id => id === documentId);
  return allowed || null;
}

/** Mailbox recipients receive the same current document policy as a portal principal. */
export async function authorizedRecipientCommentDocument(
  db: Knex, tenant: string, ticketId: string, commentId: string, documentId: string, recipient: string,
  options?: { allowInternal?: boolean },
) {
  return runWithTenant(tenant, () => withTransaction(db, async trx => {
    const scoped = tenantDb(trx, tenant);
    const row = await scoped.table('ticket_comment_attachments')
      .where({ ticket_id: ticketId, comment_id: commentId, document_id: documentId, state: 'attached' }).first();
    if (!row) return null;
    const isPublic = await isPublicAttachmentComment(trx, tenant, commentId, ticketId);
    if (!isPublic) {
      if (!options?.allowInternal) return null;
      const comment = await scoped.table('comments').where({ comment_id: commentId, ticket_id: ticketId }).first();
      const thread = comment && await scoped.table('comment_threads')
        .where({ thread_id: comment.thread_id, ticket_id: ticketId }).first();
      if (!comment || !thread || comment.deleted_at || comment.publish_state !== 'published') return null;
    }
    return authorizeTicketDocument(trx, tenant, ticketId, documentId, recipient, !isPublic);
  }));
}

/** Legacy ticket documents must not bypass a managed comment's lifecycle. */
export async function authorizedRecipientTicketDocument(
  db: Knex, tenant: string, ticketId: string, documentId: string, recipient: string,
) {
  return runWithTenant(tenant, () => withTransaction(db, async trx => {
    const scoped = tenantDb(trx, tenant);
    const managed = await scoped.table('ticket_comment_attachments').where({ document_id: documentId }).first();
    if (managed) return null;
    const association = await scoped.table('document_associations')
      .where({ document_id: documentId, entity_type: 'ticket', entity_id: ticketId }).first();
    if (!association) return null;
    return authorizeTicketDocument(trx, tenant, ticketId, documentId, recipient, false);
  }));
}

function referencesDocument(source: string, document: { file_id: string; document_id: string }): boolean {
  const id = referencedDocumentFileId(source);
  return id !== null && (id === document.file_id || id === document.document_id);
}

function replaceDocumentImages(
  html: string,
  document: { file_id: string; document_id: string },
  replacement: (tag: string) => string,
): string {
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const source = /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(tag);
    return source && referencesDocument(source[2], document) ? replacement(tag) : tag;
  });
}

export async function prepareCommentAttachmentEmail(input: {
  db: Knex; tenant: string; ticketId: string; commentId: string; recipient: string;
  maxAttachmentBytes: number; supportsAttachments: boolean; baseUrl: string; blockedAttachmentExtensions?: string[];
  recipients?: readonly string[]; allowInternal?: boolean; imageOnly?: boolean;
  sharedDocumentAccess?: boolean;
  authorizedSponsorRecipient?: string;
  allowInlineImages: boolean; suppressProtectedContent: boolean;
  protectedContentText: string;
  missingImageText?: string; renderOptions?: RichTextRenderOptions;
  download?: (fileId: string) => Promise<{ buffer: Buffer }>;
  signingSecret?: string;
}) {
  const { db, tenant, ticketId, commentId } = input;
  const recipients = [...new Set([input.recipient, ...(input.recipients ?? [])].map(recipient => recipient.trim().toLowerCase()))];
  if (recipients.some(recipient => !recipient)) throw new Error('Every attachment email recipient must have an address');
  const missingImageText = input.missingImageText ?? '[Image not included]';
  if (!missingImageText.trim()) throw new Error('An unavailable inline-image marker is required');
  if (!input.protectedContentText.trim()) throw new Error('A protected-content marker is required');
  const scoped = tenantDb(db, tenant);
  const comment = await scoped.table('comments').where({ ticket_id: ticketId, comment_id: commentId }).first();
  const managed = Boolean(await scoped.table('ticket_comment_attachments').where({ comment_id: commentId }).first());
  const empty = { html: '', text: '', attachments: [] as EmailAttachment[], managed, downloadLinks: [] as string[], redacted: true };
  if (!comment || comment.deleted_at || comment.publish_state !== 'published') return empty;
  const isPublic = await isPublicAttachmentComment(db, tenant, commentId, ticketId);
  const thread = await scoped.table('comment_threads').where({ thread_id: comment.thread_id, ticket_id: ticketId }).first();
  if (!thread) return empty;
  if (!isPublic && (!input.allowInternal ||
    !(await Promise.all(recipients.map(async recipient =>
      recipient === input.authorizedSponsorRecipient ||
      await recipientCanReceiveInternalComment(db, tenant, ticketId, recipient)))).every(Boolean))) {
    return empty;
  }
  let documents = isPublic ? await listPublishedCommentAttachments(db, tenant, ticketId, commentId) : await (async () => {
    const query = scoped.table('ticket_comment_attachments as a')
      .where({ 'a.ticket_id': ticketId, 'a.comment_id': commentId, 'a.state': 'attached' });
    scoped.tenantJoin(query, 'documents as d', 'a.document_id', 'd.document_id');
    return query.select('d.document_id', 'd.file_id', 'd.document_name', 'd.mime_type', 'd.file_size').orderBy('a.attachment_id');
  })();
  if (input.imageOnly || !isPublic) {
    documents = documents.filter(document => isImageFile(document.document_name, document.mime_type));
  }
  const allowedDocuments = (await Promise.all(documents.map(async document => {
    const image = isImageFile(document.document_name, document.mime_type);
    const mimeType = document.mime_type?.trim().toLowerCase();
    if (input.sharedDocumentAccess === false || input.suppressProtectedContent ||
      (image && !mimeType?.startsWith('image/')) ||
      (!input.allowInlineImages && (image || !mimeType || mimeType === 'application/octet-stream'))) return null;
    const grants = await Promise.all(recipients.map(recipient => authorizedRecipientCommentDocument(
      db, tenant, ticketId, commentId, document.document_id, recipient, { allowInternal: input.allowInternal },
    )));
    return grants.every(grant => grant && grant.file_id === document.file_id &&
      (!document.document_name || grant.document_name === document.document_name) &&
      (!document.mime_type || grant.mime_type === document.mime_type)) ? document : null;
  }))).filter((document): document is NonNullable<typeof document> => document !== null);
  const deniedDocuments = documents.filter(document => !allowedDocuments.includes(document));
  const deniedDocumentIds = new Set(deniedDocuments.flatMap(document => [document.file_id, document.document_id]));
  const deniedImageIds = new Set(deniedDocuments
    .filter(document => isImageFile(document.document_name, document.mime_type))
    .flatMap(document => [document.file_id, document.document_id]));
  const contentPolicy = {
    allowInlineImages: input.allowInlineImages,
    suppressProtectedContent: input.suppressProtectedContent,
    missingImageText,
    protectedContentText: input.protectedContentText,
    deniedDocumentIds,
    deniedImageIds,
  };
  const sanitized = redactTicketEmailStructuredContent(comment.note || '', contentPolicy);
  const formatted = formatBlockNoteContent(sanitized.content, input.renderOptions);
  const [safeHtml, safeText] = await Promise.all([
    redactTicketEmailRenderedContent(formatted.html, 'html', contentPolicy),
    redactTicketEmailRenderedContent(formatted.text, 'text', contentPolicy),
  ]);
  let redacted = deniedDocuments.length > 0 || sanitized.redacted || safeHtml.redacted || safeText.redacted;
  let html = safeHtml.value;
  let text = safeText.value;
  if (deniedDocuments.length) {
    logger.info('[TicketEmail] Comment attachments were not included', {
      tenantId: tenant, ticketId, commentId, count: deniedDocuments.length,
    });
    if (!sanitized.redacted && !safeHtml.redacted && !safeText.redacted) {
      const marker = deniedImageIds.size ? missingImageText : input.protectedContentText;
      html += `<p>${escape(marker)}</p>`;
      text += `${text ? '\n' : ''}${marker}`;
    }
  }
  const attachments: EmailAttachment[] = [];
  const links: string[] = [];
  const attachedNames: string[] = [];
  const plainLinks: string[] = [];
  if (!documents.length) return { html, text, attachments, managed, downloadLinks: [] as string[], redacted };
  // Reserve room for MIME/base64 expansion, headers and the rendered template.
  const budget = Math.max(0, Math.floor(input.maxAttachmentBytes * 0.70) - 64 * 1024);
  let used = 0;
  for (const document of allowedDocuments) {
    const name = document.document_name || 'Attachment';
    let buffer: Buffer | null = null;
    const blockedType = input.blockedAttachmentExtensions?.includes(name.split('.').pop()!.toLowerCase());
    if (!blockedType && input.supportsAttachments && Number(document.file_size) <= budget - used) {
      // Event consumers run outside request/session AsyncLocalStorage. Bind the
      // event tenant explicitly before storage resolves its file record.
      buffer = (await runWithTenant(tenant, () => (input.download || StorageService.downloadFile)(document.file_id))).buffer;
    }
    if (buffer && buffer.length <= budget - used) {
      const image = isImageFile(document.document_name, document.mime_type);
      const cid = image ? `comment-${commentId}-${document.document_id}@alga-psa` : undefined;
      attachments.push({ filename: name, content: buffer, contentType: document.mime_type, ...(cid ? { cid } : {}) });
      used += buffer.length;
      if (!image) attachedNames.push(name);
      if (cid) html = replaceDocumentImages(html, document, tag =>
        tag.replace(/\bsrc\s*=\s*(["'])(.*?)\1/i, `src="${escape(`cid:${cid}`)}"`));
    } else {
      if (isImageFile(document.document_name, document.mime_type)) {
        redacted = true;
        html = replaceDocumentImages(html, document, () => `<span>${escape(missingImageText)}</span>`);
        text = text.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (original, source: string) =>
          referencesDocument(source, document) ? missingImageText : original);
        if (recipients.length > 1 || !isPublic) continue;
      }
      if (!/^https?:\/\//.test(input.baseUrl)) throw new Error('Absolute application URL is required for attachment links');
      const token = signAttachmentLink({ tenant, ticketId, commentId, documentId: document.document_id,
        recipient: input.recipient.trim().toLowerCase(), expiresAt: Date.now() + 60 * 60 * 1000,
      }, input.signingSecret || await attachmentSigningSecret());
      const url = `${input.baseUrl.replace(/\/$/, '')}/api/ticket-comment-attachments/download?token=${encodeURIComponent(token)}`;
      links.push(`<li><a href="${escape(url)}">${escape(name)}</a></li>`);
      plainLinks.push(`${name}: ${url}`);
      // An oversized inline image should not leave a broken authenticated img in the email.
      html = replaceDocumentImages(html, document, () => `<a href="${escape(url)}">${escape(name)}</a>`);
    }
  }
  const explanation = 'Some files could not be attached because of email provider limits. Download them within one hour by verifying the email address that received this message. A portal account is not required.';
  if (attachedNames.length) html += `<p>Attached files:</p><ul>${attachedNames.map(name => `<li>${escape(name)}</li>`).join('')}</ul>`;
  if (links.length) html += `<p>${explanation}</p><ul>${links.join('')}</ul>`;
  return { html, text: text + (links.length ? `\n${explanation}\n${plainLinks.join('\n')}` : ''), attachments, managed: true, downloadLinks: plainLinks, redacted };
}

/** sending is deliberately not leased: an unknown provider outcome requires operator reconciliation, not duplicate delivery.
 * The protocol lives in shared/lib/deliveryLedger.ts; this keeps base's ledger and its signature. */
export async function claimCommentEmailDelivery(db: Knex, tenant: string, commentId: string, recipient: string): Promise<boolean> {
  return claimDelivery(db, COMMENT_EMAIL_LEDGER, tenant, { comment_id: commentId, recipient });
}
export async function finishCommentEmailDelivery(db: Knex, tenant: string, commentId: string, recipient: string, state: 'sent' | 'failed' | 'sending', outcome?: { error?: string; errorCode?: string }) {
  await finishDelivery(db, COMMENT_EMAIL_LEDGER, tenant, { comment_id: commentId, recipient }, state, outcome);
}
