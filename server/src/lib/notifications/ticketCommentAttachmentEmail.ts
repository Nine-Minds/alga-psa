import type { Knex } from 'knex';
import { tenantDb, runWithTenant, withTransaction } from '@alga-psa/db';
import { authorizeAndRedactDocuments } from '@alga-psa/documents/actions/documentActions';
import { hasPermission } from '@/lib/auth/rbac';
import { StorageService } from '@alga-psa/storage/StorageService';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { formatBlockNoteContent } from '@alga-psa/formatting/blocknoteUtils';
import { signAttachmentLink } from '@shared/lib/ticketCommentAttachmentToken';
import { listPublishedCommentAttachments, canAccessAttachmentTicket, isPublicAttachmentComment } from '@shared/lib/ticketCommentAttachments';
import type { EmailAttachment } from '../../types/email.types';

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

/** Mailbox recipients receive the same current document policy as a portal principal. */
export async function authorizedRecipientCommentDocument(db: Knex, tenant: string, ticketId: string, commentId: string, documentId: string, recipient: string) {
  return withTransaction(db, async trx => {
    const scoped = tenantDb(trx, tenant);
    const row = await scoped.table('ticket_comment_attachments').where({ ticket_id: ticketId, comment_id: commentId, document_id: documentId, state: 'attached' }).first();
    if (!row || !await isPublicAttachmentComment(trx, tenant, commentId, ticketId) ||
      !await recipientCanReceiveCommentFiles(trx, tenant, ticketId, recipient)) return null;
    const document = await scoped.table('documents').where({ document_id: documentId }).first();
    if (!document) return null;
    const ticket = await scoped.table('tickets').where({ ticket_id: ticketId }).first();
    const users = await scoped.table('users').whereRaw('lower(email) = ?', [recipient.trim().toLowerCase()]);
    // An existing disabled/restricted account cannot fall through to guest access.
    for (const user of users) {
      if (user.is_inactive || !await canAccessAttachmentTicket(trx, tenant, user.user_id, ticketId) ||
        !await hasPermission({ ...user, tenant }, 'document', 'read', trx)) continue;
      if (user.user_type === 'client' && !document.is_client_visible) continue;
      const [allowed] = await authorizeAndRedactDocuments(trx, tenant, { ...user, clientId: user.user_type === 'client' ? ticket.client_id : undefined }, [document]);
      if (allowed) return allowed;
    }
    if (users.length || !document.is_client_visible) return null;
    const contact = await scoped.table('contacts').where({ client_id: ticket.client_id }).whereRaw('lower(email) = ?', [recipient.trim().toLowerCase()]).first();
    // The verified mailbox is an explicit recipient grant, not an impersonated account.
    const principal = { tenant, user_id: contact?.contact_name_id || ticket.client_id, user_type: 'client',
      clientId: ticket.client_id, email: recipient, is_inactive: false } as any;
    const [allowed] = await authorizeAndRedactDocuments(trx, tenant, principal, [document], async id => id === documentId);
    return allowed || null;
  });
}

export async function prepareCommentAttachmentEmail(input: {
  db: Knex; tenant: string; ticketId: string; commentId: string; recipient: string;
  maxAttachmentBytes: number; supportsAttachments: boolean; baseUrl: string; blockedAttachmentExtensions?: string[];
  download?: (fileId: string) => Promise<{ buffer: Buffer }>;
  signingSecret?: string;
}) {
  const { db, tenant, ticketId, commentId } = input;
  const documents = await listPublishedCommentAttachments(db, tenant, ticketId, commentId);
  const comment = await tenantDb(db, tenant).table('comments').where({ ticket_id: ticketId, comment_id: commentId }).first();
  const allowedDocuments = (await Promise.all(documents.map(async document =>
    await authorizedRecipientCommentDocument(db, tenant, ticketId, commentId, document.document_id, input.recipient) ? document : null
  ))).filter((document): document is NonNullable<typeof document> => document !== null);
  const deniedFiles = new Set(documents.filter(document => !allowedDocuments.includes(document)).map(document => document.file_id));
  let note = comment?.note || '';
  if (deniedFiles.size) {
    try {
      const strip = (value: any): any => {
        if (Array.isArray(value)) return value.map(strip).filter(item => item !== null);
        if (!value || typeof value !== 'object') return value;
        const url = value.props?.url || value.href;
        if (typeof url === 'string' && [...deniedFiles].some(id => url.includes(id))) return null;
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, strip(child)]));
      };
      note = JSON.stringify(strip(JSON.parse(note)));
    } catch { note = ''; } // Legacy content that cannot be safely filtered is not emailed.
  }
  const formatted = formatBlockNoteContent(note);
  let html = formatted.html;
  const attachments: EmailAttachment[] = [];
  const links: string[] = [];
  const attachedNames: string[] = [];
  const plainLinks: string[] = [];
  const managed = Boolean(await tenantDb(db, tenant).table('ticket_comment_attachments').where({ comment_id: commentId }).first());
  if (!documents.length) return { html, text: formatted.text, attachments, managed, downloadLinks: [] as string[] };
  if (!await recipientCanReceiveCommentFiles(db, tenant, ticketId, input.recipient)) {
    return { html, text: formatted.text, attachments, managed: true, downloadLinks: [] as string[] };
  }
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
      const image = document.mime_type?.startsWith('image/');
      const cid = image ? `comment-${commentId}-${document.document_id}@alga-psa` : undefined;
      attachments.push({ filename: name, content: buffer, contentType: document.mime_type, ...(cid ? { cid } : {}) });
      used += buffer.length;
      if (!image) attachedNames.push(name);
      if (cid) html = html.replace(new RegExp(`(?:https?://[^"'<> ]+)?/api/documents/view/${document.file_id}`, 'g'), `cid:${cid}`);
    } else {
      if (!/^https?:\/\//.test(input.baseUrl)) throw new Error('Absolute application URL is required for attachment links');
      const token = signAttachmentLink({ tenant, ticketId, commentId, documentId: document.document_id,
        recipient: input.recipient.trim().toLowerCase(), expiresAt: Date.now() + 60 * 60 * 1000,
      }, input.signingSecret || await attachmentSigningSecret());
      const url = `${input.baseUrl.replace(/\/$/, '')}/api/ticket-comment-attachments/download?token=${encodeURIComponent(token)}`;
      links.push(`<li><a href="${escape(url)}">${escape(name)}</a></li>`);
      plainLinks.push(`${name}: ${url}`);
      // An oversized inline image should not leave a broken authenticated img in the email.
      html = html.replace(new RegExp(`<img\\b[^>]*${document.file_id}[^>]*>`, 'gi'), `<a href="${escape(url)}">${escape(name)}</a>`);
    }
  }
  const explanation = 'Some files could not be attached because of email provider limits. Download them within one hour by verifying the email address that received this message. A portal account is not required.';
  if (attachedNames.length) html += `<p>Attached files:</p><ul>${attachedNames.map(name => `<li>${escape(name)}</li>`).join('')}</ul>`;
  if (links.length) html += `<p>${explanation}</p><ul>${links.join('')}</ul>`;
  return { html, text: formatted.text + (links.length ? `\n${explanation}\n${plainLinks.join('\n')}` : ''), attachments, managed: true, downloadLinks: plainLinks };
}

/** sending is deliberately not leased: an unknown provider outcome requires operator reconciliation, not duplicate delivery. */
export async function claimCommentEmailDelivery(db: Knex, tenant: string, commentId: string, recipient: string): Promise<boolean> {
  const table = () => tenantDb(db, tenant).table('ticket_comment_email_deliveries');
  const key = { tenant, comment_id: commentId, recipient: recipient.trim().toLowerCase() };
  const inserted = await table().insert({ ...key, state: 'sending' }).onConflict(['tenant', 'comment_id', 'recipient']).ignore().returning('comment_id');
  if (inserted.length) return true;
  const retried = await table().where(key).where({ state: 'failed' }).update({ state: 'sending', updated_at: new Date(), attempts: db.raw('attempts + 1'), last_error: null, error_code: null, requires_reconciliation: false });
  return retried > 0;
}
export async function finishCommentEmailDelivery(db: Knex, tenant: string, commentId: string, recipient: string, state: 'sent' | 'failed' | 'sending', outcome?: { error?: string; errorCode?: string }) {
  await tenantDb(db, tenant).table('ticket_comment_email_deliveries').where({ comment_id: commentId, recipient: recipient.trim().toLowerCase(), state: 'sending' }).update({ state, updated_at: new Date(), last_error: outcome?.error || null, error_code: outcome?.errorCode || null, requires_reconciliation: state === 'sending' });
}
