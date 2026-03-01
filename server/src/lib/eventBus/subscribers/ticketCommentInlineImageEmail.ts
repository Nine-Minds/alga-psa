import type { Knex } from 'knex';
import type { EmailAttachment } from '../../../types/email.types';
import { StorageService } from '../../storage/StorageService';

const IMG_SRC_REGEX = /<img\b[^>]*\bsrc=(["'])(.*?)\1/gi;
const DOCUMENT_VIEW_PATH_REGEX = /^\/api\/documents\/view\/([^/?#]+)$/i;

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
    | 'storage_download_failed';
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
}): Promise<RewriteTicketCommentImagesResult> {
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
    .select('d.document_id', 'd.document_name', 'd.file_id', 'd.mime_type');

  const documentByFileId = new Map(
    ticketImageDocuments
      .filter((doc: any) => typeof doc.file_id === 'string' && doc.file_id.length > 0)
      .map((doc: any) => [doc.file_id as string, doc])
  );

  const attachments: EmailAttachment[] = [];
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

    try {
      const downloadResult = await StorageService.downloadFile(fileId);
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
