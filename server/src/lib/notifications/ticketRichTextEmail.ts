import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import { formatBlockNoteContent, type RichTextRenderOptions } from '@alga-psa/formatting/blocknoteUtils';
import { isPublicAttachmentComment } from '@shared/lib/ticketCommentAttachments';
import type { EmailAddress, EmailAttachment } from '../../types/email.types';
import {
  extractDocumentViewFileId,
  rewriteTicketCommentImagesToCid,
  type InlineImageRewriteOutcome,
} from '../eventBus/subscribers/ticketCommentInlineImageEmail';
import {
  authorizedRecipientTicketDocument,
  classifyTicketEmailRecipient,
  prepareCommentAttachmentEmail,
  recipientCanReceiveInternalComment,
} from './ticketCommentAttachmentEmail';
import {
  redactTicketEmailRenderedContent,
  redactTicketEmailStructuredContent,
  type TicketEmailAudiencePolicy,
} from './ticketEmailContentPolicy';

export function messageRecipients(to: string, cc?: readonly EmailAddress[], bcc?: readonly EmailAddress[]): string[] {
  const recipients = [to, ...(cc ?? []).map(address => address.email), ...(bcc ?? []).map(address => address.email)]
    .map(address => address.trim().toLowerCase());
  if (recipients.some(recipient => !recipient)) {
    throw new Error('Every ticket email recipient must have an address');
  }
  return [...new Set(recipients)];
}

export async function resolveTicketEmailAudience(
  db: Knex,
  tenant: string,
  ticketIds: readonly string[],
  recipients: readonly string[],
): Promise<TicketEmailAudiencePolicy> {
  if (!recipients.length || recipients.some(recipient => !recipient.trim())) {
    throw new Error('Ticket rich-text email requires at least one recipient');
  }
  const sources = [...new Set(ticketIds.filter(Boolean))];
  if (!sources.length) return { allowInlineImages: false, suppressProtectedContent: true };
  const classifications = (await Promise.all(sources.flatMap(ticketId => recipients.map(recipient =>
    classifyTicketEmailRecipient(db, tenant, ticketId, recipient))))).flat();
  return {
    allowInlineImages: classifications.every(kind => kind === 'internal'),
    suppressProtectedContent: classifications.includes('unknown') ||
      (classifications.includes('internal') && classifications.includes('external')),
  };
}

function replaceUnavailableTextImages(
  text: string,
  outcomes: InlineImageRewriteOutcome[],
  missingImageText: string,
): string {
  const unavailableOutcomes = outcomes.filter(outcome => outcome.strategy === 'placeholder');
  const unavailableSources = new Set(unavailableOutcomes.map(outcome => outcome.sourceUrl));
  const unavailableFiles = new Set(unavailableOutcomes
    .filter(outcome => outcome.resolvedFileId)
    .map(outcome => outcome.resolvedFileId));
  return text.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (original, source: string) => {
    const fileId = extractDocumentViewFileId(source);
    return unavailableSources.has(source) || (fileId && unavailableFiles.has(fileId)) ? missingImageText : original;
  });
}

export interface TicketRichTextEmailInput extends TicketEmailAudiencePolicy {
  db: Knex;
  tenant: string;
  ticketId: string;
  commentId: string;
  recipients: readonly string[];
  audience: 'public' | 'authorized';
  requireResolution?: boolean;
  imageOnly?: boolean;
  sharedDocumentAccess?: boolean;
  authorizedSponsorRecipient?: string;
  capabilities: {
    supportsAttachments: boolean;
    maxAttachmentSize?: number;
    blockedAttachmentExtensions?: readonly string[];
  };
  baseUrl: string;
  missingImageText: string;
  protectedContentText: string;
  unsupportedContentText: string;
}

export interface PreparedTicketRichTextEmail {
  html: string;
  text: string;
  attachments: EmailAttachment[];
  downloadLinks: string[];
  managed: boolean;
  redacted: boolean;
  rawContent?: unknown;
}

type TicketImageContentInput = Pick<TicketRichTextEmailInput,
  'db' | 'tenant' | 'ticketId' | 'recipients' | 'capabilities' | 'missingImageText' |
  'protectedContentText' | 'allowInlineImages' | 'suppressProtectedContent' | 'sharedDocumentAccess'> & { commentId?: string };

function emailRenderOptions(input: {
  tenant: string; ticketId: string; commentId?: string; missingImageText: string; unsupportedContentText: string;
}): RichTextRenderOptions {
  const logged = new Set<string>();
  return {
    unsupportedContentPlaceholder: input.unsupportedContentText,
    missingImagePlaceholder: input.missingImageText,
    onUnsupportedContent: blockType => {
      if (logged.has(blockType)) return;
      logged.add(blockType);
      logger.warn('[TicketEmail] Unsupported rich-text content was replaced', {
        tenantId: input.tenant, ticketId: input.ticketId, commentId: input.commentId, blockType,
      });
    },
  };
}

async function prepareInlineImages(
  input: TicketImageContentInput,
  content: { html: string; text: string; attachments: EmailAttachment[]; redacted: boolean },
): Promise<typeof content> {
  const maxAttachmentBytes = input.capabilities.maxAttachmentSize ?? 0;
  if (!Number.isFinite(maxAttachmentBytes) || maxAttachmentBytes < 0) {
    throw new Error('The email provider returned an invalid attachment size limit');
  }
  const used = content.attachments.reduce((total, attachment) =>
    total + (Buffer.isBuffer(attachment.content) ? attachment.content.length : Buffer.byteLength(attachment.content)), 0);
  const remaining = Math.max(0, Math.floor(maxAttachmentBytes * 0.70) - 64 * 1024 - used);
  const rewritten = await rewriteTicketCommentImagesToCid({
    db: input.db,
    tenantId: input.tenant,
    ticketId: input.ticketId,
    html: content.html,
    missingImageText: input.missingImageText,
    allowInlineImages: input.allowInlineImages,
    supportsAttachments: input.capabilities.supportsAttachments && remaining > 0,
    blockedAttachmentExtensions: input.capabilities.blockedAttachmentExtensions,
    limits: { maxInlineImageTotalBytes: Math.max(1, remaining) },
    authorizeDocument: async (documentId, document) => {
      if (input.sharedDocumentAccess === false) return false;
      const grants = await Promise.all(input.recipients.map(recipient =>
        authorizedRecipientTicketDocument(input.db, input.tenant, input.ticketId, documentId, recipient)));
      return grants.every(grant => grant && grant.file_id === document.file_id &&
        (!document.document_name || grant.document_name === document.document_name) &&
        (!document.mime_type || grant.mime_type === document.mime_type));
    },
  });
  for (const outcome of rewritten.outcomes) {
    if (outcome.strategy === 'placeholder') {
      logger.info('[TicketEmail] Inline image was not included', {
        tenantId: input.tenant,
        ticketId: input.ticketId,
        commentId: input.commentId,
        fileId: outcome.resolvedFileId,
        reason: outcome.reason,
      });
    }
  }
  const [safeHtml, safeText] = await Promise.all([
    redactTicketEmailRenderedContent(rewritten.html, 'html', input),
    redactTicketEmailRenderedContent(
      replaceUnavailableTextImages(content.text, rewritten.outcomes, input.missingImageText), 'text', input,
    ),
  ]);
  return {
    html: safeHtml.value,
    text: safeText.value,
    attachments: [...content.attachments, ...rewritten.attachments],
    redacted: content.redacted || safeHtml.redacted || safeText.redacted ||
      rewritten.outcomes.some(outcome => outcome.strategy === 'placeholder'),
  };
}

/**
 * Reconstruct a persisted comment at delivery time. A shared MIME message can
 * contain images only for authorized internal To/Cc/Bcc recipients.
 */
export async function prepareTicketCommentRichTextEmail(
  input: TicketRichTextEmailInput,
): Promise<PreparedTicketRichTextEmail | null> {
  if (!input.recipients.length || input.recipients.some(recipient => !recipient.trim())) {
    throw new Error('Ticket rich-text email requires at least one recipient');
  }
  const maxAttachmentBytes = input.capabilities.maxAttachmentSize ?? 0;
  if (!Number.isFinite(maxAttachmentBytes) || maxAttachmentBytes < 0) {
    throw new Error('The email provider returned an invalid attachment size limit');
  }

  const scoped = tenantDb(input.db, input.tenant);
  const comment = await scoped.table('comments')
    .where({ ticket_id: input.ticketId, comment_id: input.commentId }).first();
  if (!comment || comment.deleted_at || comment.publish_state !== 'published' ||
    (input.requireResolution && !comment.is_resolution)) return null;
  const thread = await scoped.table('comment_threads')
    .where({ thread_id: comment.thread_id, ticket_id: input.ticketId }).first();
  if (!thread) return null;

  const isPublic = await isPublicAttachmentComment(input.db, input.tenant, input.commentId, input.ticketId);
  if (!isPublic) {
    if (input.audience === 'public') return null;
    const permitted = await Promise.all(input.recipients.map(async recipient =>
      recipient === input.authorizedSponsorRecipient ||
      await recipientCanReceiveInternalComment(input.db, input.tenant, input.ticketId, recipient)));
    if (!permitted.every(Boolean)) return null;
  }

  const managed = Boolean(await scoped.table('ticket_comment_attachments').where({ comment_id: input.commentId }).first());
  const renderOptions = emailRenderOptions(input);
  let html: string;
  let text: string;
  let attachments: EmailAttachment[] = [];
  let downloadLinks: string[] = [];
  let redacted = false;
  if (managed) {
    const prepared = await prepareCommentAttachmentEmail({
      db: input.db,
      tenant: input.tenant,
      ticketId: input.ticketId,
      commentId: input.commentId,
      recipient: input.recipients[0],
      recipients: input.recipients,
      allowInternal: true,
      imageOnly: input.imageOnly,
      sharedDocumentAccess: input.sharedDocumentAccess,
      authorizedSponsorRecipient: input.authorizedSponsorRecipient,
      allowInlineImages: input.allowInlineImages,
      suppressProtectedContent: input.suppressProtectedContent,
      maxAttachmentBytes,
      supportsAttachments: input.capabilities.supportsAttachments,
      blockedAttachmentExtensions: input.capabilities.blockedAttachmentExtensions
        ? [...input.capabilities.blockedAttachmentExtensions] : undefined,
      baseUrl: input.baseUrl,
      missingImageText: input.missingImageText,
      protectedContentText: input.protectedContentText,
      renderOptions,
    });
    ({ html, text, attachments, downloadLinks, redacted } = prepared);
  } else {
    const sanitized = redactTicketEmailStructuredContent(comment.note, input);
    ({ html, text } = formatBlockNoteContent(sanitized.content, renderOptions));
    redacted = sanitized.redacted;
  }

  const rewritten = await prepareInlineImages(input, { html, text, attachments, redacted });
  return { ...rewritten, downloadLinks, managed, rawContent:
    rewritten.redacted || !input.allowInlineImages || input.suppressProtectedContent ? null : comment.note };
}

export async function prepareTicketDescriptionRichTextEmail(
  input: Omit<TicketRichTextEmailInput, 'commentId' | 'requireResolution' | 'imageOnly'> & { commentId?: string },
): Promise<PreparedTicketRichTextEmail | null> {
  if (input.commentId) {
    return prepareTicketCommentRichTextEmail({ ...input, commentId: input.commentId, imageOnly: true });
  }
  if (!input.recipients.length || input.recipients.some(recipient => !recipient.trim())) {
    throw new Error('Ticket rich-text email requires at least one recipient');
  }
  const ticket = await tenantDb(input.db, input.tenant).table('tickets').where({ ticket_id: input.ticketId }).first();
  if (!ticket) return null;
  const attributes = ticket.attributes && typeof ticket.attributes === 'object'
    ? ticket.attributes as Record<string, unknown> : {};
  const description = attributes.description || ticket.description;
  if (!description) return null;
  const sanitized = redactTicketEmailStructuredContent(description, input);
  const { html, text } = formatBlockNoteContent(sanitized.content, emailRenderOptions(input));
  const rewritten = await prepareInlineImages(input, { html, text, attachments: [], redacted: sanitized.redacted });
  return { ...rewritten, downloadLinks: [], managed: false };
}
