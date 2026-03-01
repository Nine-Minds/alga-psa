import type { Knex } from 'knex';
import type { EmailAttachment } from '../../../types/email.types';
import { StorageService } from '../../storage/StorageService';

const IMG_SRC_REGEX = /<img\b[^>]*\bsrc=(["'])(.*?)\1/gi;
const DOCUMENT_VIEW_PATH_REGEX = /^\/api\/documents\/view\/([^/?#]+)$/i;
const DEFAULT_MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_INLINE_IMAGE_TOTAL_BYTES = 15 * 1024 * 1024;
const DEFAULT_MAX_INLINE_IMAGE_COUNT = 10;

export interface InlineImageRewriteOutcome {
  sourceUrl: string;
  resolvedFileId?: string;
  strategy: 'cid' | 'url-fallback';
  reason:
    | 'converted_to_cid'
    | 'not_document_view_url'
    | 'missing_file_id'
    | 'not_ticket_document'
    | 'non_image_document'
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
  if (!src || typeof src !== 'string') return null;

  try {
    const url = new URL(src, 'https://example.invalid');
    const match = DOCUMENT_VIEW_PATH_REGEX.exec(url.pathname);
    if (!match?.[1]) return null;
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function rewriteHtmlImageSources(html: string, replacementMap: Map<string, string>): string {
  if (replacementMap.size === 0) return html;
  return html.replace(IMG_SRC_REGEX, (fullMatch: string, quote: string, srcValue: string) => {
    const replacement = replacementMap.get(srcValue.trim());
    if (!replacement) return fullMatch;
    return fullMatch.replace(`${quote}${srcValue}${quote}`, `${quote}${replacement}${quote}`);
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
  limits?: Partial<InlineImageRewriteLimits>;
}): Promise<RewriteTicketCommentImagesResult> {
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
  const outcomes: InlineImageRewriteOutcome[] = [];

  for (const source of uniqueSources) {
    const fileId = extractDocumentViewFileId(source);
    if (!fileId) {
      outcomes.push({
        sourceUrl: source,
        strategy: 'url-fallback',
        reason: 'not_document_view_url',
      });
      continue;
    }
    sourceFileIds.set(source, fileId);
  }

  if (sourceFileIds.size === 0) {
    return {
      html: params.html,
      attachments: [],
      outcomes,
    };
  }

  const fileIds = Array.from(new Set(sourceFileIds.values()));
  const ticketImageDocuments = await params.db('documents as d')
    .join('document_associations as da', function joinAssociations() {
      this.on('da.document_id', '=', 'd.document_id').andOn('da.tenant', '=', 'd.tenant');
    })
    .where('d.tenant', params.tenantId)
    .whereIn('d.file_id', fileIds)
    .andWhere('da.entity_type', 'ticket')
    .andWhere('da.entity_id', params.ticketId)
    .select('d.document_id', 'd.document_name', 'd.file_id', 'd.mime_type', 'd.file_size');

  const documentByFileId = new Map(
    ticketImageDocuments
      .filter((doc: any) => typeof doc.file_id === 'string' && doc.file_id.length > 0)
      .map((doc: any) => [doc.file_id as string, doc])
  );

  const attachments: EmailAttachment[] = [];
  let totalInlineAttachmentBytes = 0;
  const replacementMap = new Map<string, string>();

  for (const [source, fileId] of sourceFileIds.entries()) {
    const document = documentByFileId.get(fileId);
    if (!document) {
      outcomes.push({
        sourceUrl: source,
        resolvedFileId: fileId,
        strategy: 'url-fallback',
        reason: 'not_ticket_document',
      });
      continue;
    }

    if (!isImageMimeType(document.mime_type)) {
      outcomes.push({
        sourceUrl: source,
        resolvedFileId: fileId,
        strategy: 'url-fallback',
        reason: 'non_image_document',
      });
      continue;
    }

    if (attachments.length >= limits.maxInlineImageCount) {
      outcomes.push({
        sourceUrl: source,
        resolvedFileId: fileId,
        strategy: 'url-fallback',
        reason: 'attachment_count_exceeded',
      });
      continue;
    }

    const declaredSize = Number(document.file_size || 0);
    if (Number.isFinite(declaredSize) && declaredSize > 0 && declaredSize > limits.maxInlineImageBytes) {
      outcomes.push({
        sourceUrl: source,
        resolvedFileId: fileId,
        strategy: 'url-fallback',
        reason: 'attachment_over_max_bytes',
      });
      continue;
    }

    try {
      const downloadResult = await StorageService.downloadFile(fileId);
      const inlineBytes = Buffer.isBuffer(downloadResult.buffer)
        ? downloadResult.buffer.length
        : Buffer.byteLength(String(downloadResult.buffer || ''), 'utf-8');
      if (inlineBytes > limits.maxInlineImageBytes) {
        outcomes.push({
          sourceUrl: source,
          resolvedFileId: fileId,
          strategy: 'url-fallback',
          reason: 'attachment_over_max_bytes',
        });
        continue;
      }
      if (totalInlineAttachmentBytes + inlineBytes > limits.maxInlineImageTotalBytes) {
        outcomes.push({
          sourceUrl: source,
          resolvedFileId: fileId,
          strategy: 'url-fallback',
          reason: 'attachment_total_bytes_exceeded',
        });
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
        contentType: downloadResult.metadata.mime_type || document.mime_type || 'application/octet-stream',
        cid,
      });
      totalInlineAttachmentBytes += inlineBytes;

      replacementMap.set(source, `cid:${cid}`);
      outcomes.push({
        sourceUrl: source,
        resolvedFileId: fileId,
        strategy: 'cid',
        reason: 'converted_to_cid',
      });
    } catch (error) {
      outcomes.push({
        sourceUrl: source,
        resolvedFileId: fileId,
        strategy: 'url-fallback',
        reason: 'storage_download_failed',
      });
    }
  }

  return {
    html: rewriteHtmlImageSources(params.html, replacementMap),
    attachments,
    outcomes,
  };
}
