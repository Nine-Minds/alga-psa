import type { Knex } from 'knex';
import { tenantDb, runWithTenant } from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { formatBlockNoteContent } from '@alga-psa/formatting/blocknoteUtils';
import { signAttachmentLink } from '@shared/lib/ticketCommentAttachmentToken';
import { listPublishedCommentAttachments, canAccessAttachmentTicket } from '@shared/lib/ticketCommentAttachments';
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
  const users = await scoped.table('users').whereRaw('lower(email) = ?', [recipient.toLowerCase()]).where({ is_inactive: false });
  for (const user of users) {
    if (await canAccessAttachmentTicket(db, tenant, user.user_id, ticketId)) return true;
  }
  const contact = await scoped.table('contacts').where({ client_id: ticket.client_id }).whereRaw('lower(email) = ?', [recipient.toLowerCase()]).first();
  if (contact) {
    if (!contact.portal_visibility_group_id) return true;
    const group = await scoped.table('client_portal_visibility_groups').where({ group_id: contact.portal_visibility_group_id, client_id: ticket.client_id }).first();
    return Boolean(group && await scoped.table('client_portal_visibility_group_boards').where({ group_id: group.group_id, board_id: ticket.board_id }).first());
  }
  const client = await scoped.table('clients').where({ client_id: ticket.client_id }).first();
  return typeof client?.email === 'string' && client.email.toLowerCase() === recipient.toLowerCase();
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
  const formatted = formatBlockNoteContent(comment?.note || '');
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
  for (const document of documents) {
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
  const explanation = 'Some files could not be attached because of email provider limits. Download them within one hour by signing in with the email address that received this message.';
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
  const retried = await table().where(key).where({ state: 'failed' }).update({ state: 'sending', updated_at: new Date() });
  return retried > 0;
}
export async function finishCommentEmailDelivery(db: Knex, tenant: string, commentId: string, recipient: string, state: 'sent' | 'failed') {
  await tenantDb(db, tenant).table('ticket_comment_email_deliveries').where({ comment_id: commentId, recipient: recipient.trim().toLowerCase(), state: 'sending' }).update({ state, updated_at: new Date() });
}
