import type { Knex } from 'knex';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import type { EmailAttachment } from '../../../types/email.types';
import { StorageService } from '@alga-psa/storage/StorageService';
import { isProtectedDocumentUrl, referencedDocumentFileId } from '../../notifications/ticketEmailContentPolicy';

const IMG_SRC_REGEX = /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi;
const IMG_TAG_REGEX = /<img\b[^>]*>/gi;
const IMG_SRC_ATTRIBUTE_REGEX = /\bsrc\s*=\s*(["'])(.*?)\1/i;
const DEFAULT_MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_INLINE_IMAGE_TOTAL_BYTES = 15 * 1024 * 1024;
const DEFAULT_MAX_INLINE_IMAGE_COUNT = 10;

export interface InlineImageRewriteOutcome {
  sourceUrl: string;
  resolvedFileId?: string;
  strategy: 'cid' | 'url-fallback' | 'placeholder';
  reason:
    | 'converted_to_cid'
    | 'audience_not_internal'
    | 'not_document_view_url'
    | 'unverified_document_url'
    | 'missing_file_id'
    | 'not_ticket_document'
    | 'non_image_document'
    | 'authorization_denied'
    | 'attachments_not_supported'
    | 'attachment_type_blocked'
    | 'attachment_count_exceeded'
    | 'attachment_over_max_bytes'
    | 'attachment_total_bytes_exceeded'
    | 'storage_download_failed';
}

interface InlineImageRewriteLimits {
  maxInlineImageBytes: number;
  maxInlineImageTotalBytes: number;
  maxInlineImageCount: number;
}

export interface TicketInlineImageDocument {
  document_id: string;
  document_name: string | null;
  file_id: string;
  mime_type: string | null;
  file_size: number | string | null;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  max: number
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function resolveInlineImageRewriteLimits(
  limits?: Partial<InlineImageRewriteLimits>
): InlineImageRewriteLimits {
  const maxInlineImageBytes = parsePositiveInteger(
    process.env.TICKET_COMMENT_EMAIL_INLINE_IMAGE_MAX_BYTES,
    DEFAULT_MAX_INLINE_IMAGE_BYTES,
    50 * 1024 * 1024
  );
  const maxInlineImageTotalBytes = parsePositiveInteger(
    process.env.TICKET_COMMENT_EMAIL_INLINE_IMAGE_MAX_TOTAL_BYTES,
    DEFAULT_MAX_INLINE_IMAGE_TOTAL_BYTES,
    100 * 1024 * 1024
  );
  const maxInlineImageCount = parsePositiveInteger(
    process.env.TICKET_COMMENT_EMAIL_INLINE_IMAGE_MAX_COUNT,
    DEFAULT_MAX_INLINE_IMAGE_COUNT,
    50
  );

  return {
    maxInlineImageBytes: Math.max(
      1,
      Math.min(
        50 * 1024 * 1024,
        Math.floor(limits?.maxInlineImageBytes ?? maxInlineImageBytes)
      )
    ),
    maxInlineImageTotalBytes: Math.max(
      1,
      Math.min(
        100 * 1024 * 1024,
        Math.floor(limits?.maxInlineImageTotalBytes ?? maxInlineImageTotalBytes)
      )
    ),
    maxInlineImageCount: Math.max(1, Math.min(50, Math.floor(limits?.maxInlineImageCount ?? maxInlineImageCount))),
  };
}

export interface RewriteTicketCommentImagesResult {
  html: string;
  attachments: EmailAttachment[];
  outcomes: InlineImageRewriteOutcome[];
}

export function extractImageSourcesFromHtml(html: string): string[] {
  if (!html || typeof html !== 'string') return [];
  const sources: string[] = [];
  let match: RegExpExecArray | null;
  IMG_SRC_REGEX.lastIndex = 0;
  while ((match = IMG_SRC_REGEX.exec(html)) !== null) {
    const src = (match[2] || '').trim();
    if (!src) continue;
    sources.push(src);
  }
  return sources;
}

export function extractDocumentViewFileId(src: string): string | null {
  return referencedDocumentFileId(src, 'view');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function rewriteHtmlImageSources(
  html: string,
  replacementMap: Map<string, string | null>,
  missingImageText: string,
): string {
  if (replacementMap.size === 0) return html;
  return html.replace(IMG_TAG_REGEX, (tag: string) => {
    const source = IMG_SRC_ATTRIBUTE_REGEX.exec(tag);
    if (!source || !replacementMap.has(source[2].trim())) return tag;
    const replacement = replacementMap.get(source[2].trim());
    if (!replacement) return `<span>${escapeHtml(missingImageText)}</span>`;
    return tag.replace(IMG_SRC_ATTRIBUTE_REGEX, `src="${escapeHtml(replacement)}"`);
  });
}

function buildInlineCid(params: { ticketId: string; fileId: string; index: number }): string {
  const { ticketId, fileId, index } = params;
  return `ticket-comment-${ticketId}-${fileId}-${index + 1}@alga-psa`;
}

function isImageMimeType(mimeType: string | null | undefined): boolean {
  return Boolean(mimeType && mimeType.toLowerCase().startsWith('image/'));
}

export async function rewriteTicketCommentImagesToCid(params: {
  db: Knex;
  tenantId: string;
  ticketId: string;
  html: string;
  authorizeDocument: (documentId: string, document: TicketInlineImageDocument) => Promise<boolean>;
  missingImageText: string;
  allowInlineImages: boolean;
  supportsAttachments: boolean;
  blockedAttachmentExtensions?: readonly string[];
  limits?: Partial<InlineImageRewriteLimits>;
}): Promise<RewriteTicketCommentImagesResult> {
  if (!params.missingImageText.trim()) {
    throw new Error('An unavailable inline-image marker is required');
  }
  const limits = resolveInlineImageRewriteLimits(params.limits);
  const imageSources = extractImageSourcesFromHtml(params.html);
  if (imageSources.length === 0) {
    return {
      html: params.html,
      attachments: [],
      outcomes: [],
    };
  }

  const uniqueSources = Array.from(new Set(imageSources));
  const sourceFileIds = new Map<string, string>();
  const replacementMap = new Map<string, string | null>();
  const outcomes: InlineImageRewriteOutcome[] = [];

  for (const source of uniqueSources) {
    if (!params.allowInlineImages) {
      replacementMap.set(source, null);
      outcomes.push({ sourceUrl: source, strategy: 'placeholder', reason: 'audience_not_internal' });
      continue;
    }
    const fileId = extractDocumentViewFileId(source);
    if (!fileId) {
      const protectedDocument = isProtectedDocumentUrl(source);
      const externallyRenderable = !protectedDocument && /^(?:https?:\/\/|data:image\/|cid:)/i.test(source);
      if (!externallyRenderable) replacementMap.set(source, null);
      outcomes.push({
        sourceUrl: source,
        strategy: externallyRenderable ? 'url-fallback' : 'placeholder',
        reason: protectedDocument ? 'unverified_document_url' : 'not_document_view_url',
      });
      continue;
    }
    sourceFileIds.set(source, fileId);
  }

  if (sourceFileIds.size === 0) {
    return {
      html: rewriteHtmlImageSources(params.html, replacementMap, params.missingImageText),
      attachments: [],
      outcomes,
    };
  }

  const fileIds = Array.from(new Set(sourceFileIds.values()));
  const db = tenantDb(params.db, params.tenantId);
  const ticketImageDocumentsQuery = db.table('documents as d');
  db.tenantJoin(ticketImageDocumentsQuery, 'document_associations as da', 'da.document_id', 'd.document_id');

  const ticketImageDocuments: TicketInlineImageDocument[] = await ticketImageDocumentsQuery
    .whereIn('d.file_id', fileIds)
    .andWhere('da.entity_type', 'ticket')
    .andWhere('da.entity_id', params.ticketId)
    .select('d.document_id', 'd.document_name', 'd.file_id', 'd.mime_type', 'd.file_size');

  const managedFiles = ticketImageDocuments.length ? await db.table('ticket_comment_attachments')
    .whereIn('document_id', ticketImageDocuments.map(doc => doc.document_id)).select('document_id') : [];
  const managedIds = new Set(managedFiles.map(row => row.document_id));
  const documentByFileId = new Map(
    ticketImageDocuments
      .filter(doc => !managedIds.has(doc.document_id))
      .filter(doc => typeof doc.file_id === 'string' && doc.file_id.length > 0)
      .map(doc => [doc.file_id, doc])
  );

  const attachments: EmailAttachment[] = [];
  let totalInlineAttachmentBytes = 0;
  const decisions = new Map<string, {
    replacement: string | null;
    strategy: 'cid' | 'placeholder';
    reason: InlineImageRewriteOutcome['reason'];
  }>();

  for (const [source, fileId] of sourceFileIds.entries()) {
    const record = (decision: {
      replacement: string | null;
      strategy: 'cid' | 'placeholder';
      reason: InlineImageRewriteOutcome['reason'];
    }) => {
      decisions.set(fileId, decision);
      replacementMap.set(source, decision.replacement);
      outcomes.push({ sourceUrl: source, resolvedFileId: fileId, strategy: decision.strategy, reason: decision.reason });
    };
    const cached = decisions.get(fileId);
    if (cached) {
      record(cached);
      continue;
    }

    const document = documentByFileId.get(fileId);
    if (!document) {
      record({ replacement: null, strategy: 'placeholder', reason: 'not_ticket_document' });
      continue;
    }

    if (!isImageMimeType(document.mime_type)) {
      record({ replacement: null, strategy: 'placeholder', reason: 'non_image_document' });
      continue;
    }

    if (!await params.authorizeDocument(document.document_id, document)) {
      record({ replacement: null, strategy: 'placeholder', reason: 'authorization_denied' });
      continue;
    }

    if (!params.supportsAttachments) {
      record({ replacement: null, strategy: 'placeholder', reason: 'attachments_not_supported' });
      continue;
    }

    const extension = document.document_name?.split('.').pop()?.toLowerCase();
    if (extension && params.blockedAttachmentExtensions?.some(blocked => blocked.toLowerCase() === extension)) {
      record({ replacement: null, strategy: 'placeholder', reason: 'attachment_type_blocked' });
      continue;
    }

    if (attachments.length >= limits.maxInlineImageCount) {
      record({ replacement: null, strategy: 'placeholder', reason: 'attachment_count_exceeded' });
      continue;
    }

    const declaredSize = Number(document.file_size || 0);
    if (Number.isFinite(declaredSize) && declaredSize > 0 && declaredSize > limits.maxInlineImageBytes) {
      record({ replacement: null, strategy: 'placeholder', reason: 'attachment_over_max_bytes' });
      continue;
    }

    try {
      const downloadResult = await runWithTenant(params.tenantId, () => StorageService.downloadFile(fileId));
      if (!Buffer.isBuffer(downloadResult.buffer)) {
        throw new Error('Storage returned an invalid inline-image buffer');
      }
      const mimeType = downloadResult.metadata.mime_type || document.mime_type;
      if (!isImageMimeType(mimeType)) {
        record({ replacement: null, strategy: 'placeholder', reason: 'non_image_document' });
        continue;
      }
      const inlineBytes = downloadResult.buffer.length;
      if (inlineBytes > limits.maxInlineImageBytes) {
        record({ replacement: null, strategy: 'placeholder', reason: 'attachment_over_max_bytes' });
        continue;
      }
      if (totalInlineAttachmentBytes + inlineBytes > limits.maxInlineImageTotalBytes) {
        record({ replacement: null, strategy: 'placeholder', reason: 'attachment_total_bytes_exceeded' });
        continue;
      }
      const cid = buildInlineCid({
        ticketId: params.ticketId,
        fileId,
        index: attachments.length,
      });

      attachments.push({
        filename: document.document_name || `inline-image-${attachments.length + 1}`,
        content: downloadResult.buffer,
        contentType: mimeType || 'application/octet-stream',
        cid,
      });
      totalInlineAttachmentBytes += inlineBytes;

      record({ replacement: `cid:${cid}`, strategy: 'cid', reason: 'converted_to_cid' });
    } catch (error) {
      logger.warn('[TicketEmail] Unable to retrieve inline image', {
        tenantId: params.tenantId,
        ticketId: params.ticketId,
        fileId,
        error: error instanceof Error ? error.message : String(error),
      });
      record({ replacement: null, strategy: 'placeholder', reason: 'storage_download_failed' });
    }
  }

  return {
    html: rewriteHtmlImageSources(params.html, replacementMap, params.missingImageText),
    attachments,
    outcomes,
  };
}
