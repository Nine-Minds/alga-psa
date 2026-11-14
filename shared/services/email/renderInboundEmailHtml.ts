/**
 * Render the archived original of an inbound email as display HTML.
 *
 * Ingest converts inbound mail into BlockNote blocks, which is what
 * `comments.note` and `tickets.attributes.description` store. That conversion
 * is lossy by design — tables, quote styling and signature layout flatten into
 * paragraphs — so a long reply chain reads much worse than the message the
 * sender actually wrote. The raw MIME is already archived as the
 * `original_email` artifact, so the formatted view is derived on read rather
 * than persisted a third time: no migration on distributed tables, no row
 * bloat, nothing new to keep in sync with
 * `applyEmbeddedImageUrlMappingsToStoredBodies`, and every ticket that already
 * has an archived `.eml` gains the view.
 *
 * Read-only and best effort. `null` means "no formatted view exists" (ingress
 * over the raw-MIME cap, an artifact that failed or was skipped, a ticket older
 * than the artifact pipeline) and callers must hide their toggle rather than
 * show an error.
 */

import type { Knex } from 'knex';
import { simpleParser } from 'mailparser';
import { tenantDb } from '@alga-psa/db';
import { sanitizeEmailHtml } from '../../lib/email/sanitizeEmailHtml';
import { INBOUND_MIME_PARSE_OPTIONS } from './inboundMimeParseOptions';
import { ORIGINAL_EMAIL_ATTACHMENT_ID, embeddedCidAttachmentId } from './inboundEmailArtifactHelpers';
import { normalizeRfc822MessageId, rfcMessageIdLookupForms } from './inboundEmailIdentity';
// The pure sibling, not `inboundEmbeddedImageUrlRewrite`: that module also
// converts bodies to BlockNote, and importing `@blocknote/server-util` into a
// route handler pulls React's `createContext` into a server graph, which makes
// the route fail to instantiate.
import {
  normalizeEmbeddedContentId,
  rewriteEmbeddedImageSourcesInContent,
} from './embeddedImageSourceRewrite';
import { getStorageProvider } from './inboundEmailSourceStager';
import type { EmbeddedImageUrlMapping } from './processInboundEmailArtifacts';

/**
 * Archived sources above this size are not rendered. Bulk is almost always
 * attachment payload rather than body markup, and a formatted view is never
 * worth streaming tens of megabytes through the request to find that out.
 */
export const MAX_RENDERABLE_EMAIL_SOURCE_BYTES = 20 * 1024 * 1024;

export interface InboundEmailHtmlLookup {
  /** Tenant-scoped or admin connection; every read below goes through `tenantDb`. */
  db: Knex | Knex.Transaction;
  tenantId: string;
  providerId: string;
  /** Message id as stored in `comments.metadata.email` / `tickets.email_metadata`. */
  messageId: string;
}

/**
 * Parse archived MIME into sanitized display HTML. Pure: no database, no
 * storage — the artifact lookup lives in `renderInboundEmailHtml`.
 *
 * Parsed with the same options as ingest so `cid:` sources survive the parse
 * and can be pointed at the documents already persisted for them; mailparser's
 * default would have inlined them as base64 data URLs instead.
 */
export async function buildInboundEmailHtmlFromMime(
  rawMime: Buffer,
  embeddedImageMappings: EmbeddedImageUrlMapping[] = []
): Promise<string | null> {
  const parsed: any = await simpleParser(rawMime, INBOUND_MIME_PARSE_OPTIONS);

  // mailparser reports a missing part as `false`, not as undefined.
  const html = typeof parsed?.html === 'string' ? parsed.html : '';
  const textAsHtml = typeof parsed?.textAsHtml === 'string' ? parsed.textAsHtml : '';
  const source = html.trim() ? html : textAsHtml;
  if (!source.trim()) {
    return null;
  }

  const withImages = rewriteEmbeddedImageSourcesInContent(source, embeddedImageMappings);
  // Link hardening belongs to the sanitizer pass: the viewer renders this in a
  // sandboxed iframe, so a bare `target="_blank"` opens into an unsandboxed
  // context and `noopener` is what keeps the opened page from reaching back
  // through `window.opener`.
  const sanitized = await sanitizeEmailHtml(withImages, { hardenLinks: true });
  if (!sanitized?.trim()) {
    return null;
  }

  return sanitized;
}

export interface ProcessedAttachmentRow {
  attachment_id: string;
  content_id: string | null;
  file_id: string | null;
  document_id: string | null;
  processing_status: string;
}

/**
 * Rebuild the `cid:` → served-document mappings the attachment pipeline
 * reported at ingest from the rows it wrote. A data-url image needs no
 * mapping: the archived MIME still carries its inline bytes.
 *
 * A body-referenced `cid:` image is stored under a synthetic row, while the
 * Content-ID lives on the provider attachment's own row (marked skipped).
 * Rows written before the synthetic row recorded its Content-ID are matched
 * through the deterministic attachment id the two rows share.
 */
export function embeddedImageMappingsFromRows(
  emailId: string,
  rows: ProcessedAttachmentRow[]
): EmbeddedImageUrlMapping[] {
  const stored = rows.filter((row) => row.processing_status === 'success' && row.file_id);
  const storedByAttachmentId = new Map(stored.map((row) => [row.attachment_id, row]));
  const byReference = new Map<string, EmbeddedImageUrlMapping>();

  const add = (contentId: string, row: ProcessedAttachmentRow) => {
    const reference = normalizeEmbeddedContentId(contentId);
    if (!reference || byReference.has(reference)) return;
    byReference.set(reference, {
      source: 'cid',
      reference,
      fileId: String(row.file_id),
      documentId: String(row.document_id ?? ''),
      url: `/api/documents/view/${row.file_id}`,
    });
  };

  for (const row of stored) {
    if (row.content_id) add(row.content_id, row);
  }
  for (const row of rows) {
    if (!row.content_id) continue;
    const embedded = storedByAttachmentId.get(
      embeddedCidAttachmentId(emailId, row.content_id, row.attachment_id)
    );
    if (embedded) add(row.content_id, embedded);
  }

  return [...byReference.values()];
}

async function loadEmbeddedImageMappings(
  lookup: InboundEmailHtmlLookup,
  emailId: string
): Promise<EmbeddedImageUrlMapping[]> {
  const rows: ProcessedAttachmentRow[] = await tenantDb(lookup.db, lookup.tenantId)
    .table('email_processed_attachments')
    .where({ provider_id: lookup.providerId, email_id: emailId })
    .where(function (this: Knex.QueryBuilder) {
      this.whereNotNull('content_id').orWhereNotNull('file_id');
    })
    .select('attachment_id', 'content_id', 'file_id', 'document_id', 'processing_status');

  return embeddedImageMappingsFromRows(emailId, rows);
}

/**
 * Narrow `email_processed_attachments` to the rows archived for one message id.
 *
 * The two sides are not written in the same shape. The durable pipeline stores
 * the canonical normalized id in `email_id`, but the default pipeline stores
 * mailparser's raw header value there — angle brackets kept, domain case
 * untouched — while `tickets.email_metadata` and `comments.metadata.email`
 * always hold the normalized form. A bracketed, mixed-case row cannot be
 * reconstructed from that normalized value, so an RFC-style id is also compared
 * with brackets trimmed and case folded on both sides. An opaque provider id
 * (Graph/Gmail, no domain) stays an exact match: those are case-sensitive and
 * folding them could match a neighbouring message.
 */
export function whereInboundEmailArtifactMessageId<T extends Knex.QueryBuilder>(
  query: T,
  messageId: string
): T {
  const forms = rfcMessageIdLookupForms(messageId);
  const normalized = normalizeRfc822MessageId(messageId);
  const folded = normalized?.includes('@') ? normalized.toLowerCase() : null;

  query.where(function (this: Knex.QueryBuilder) {
    this.whereIn('email_id', forms);
    if (folded) {
      this.orWhereRaw("lower(btrim(email_id, '<>')) = ?", [folded]);
    }
  });

  return query;
}

/** Download the archived `.eml` bytes, or null when the file is gone or oversized. */
async function readArchivedEmailSource(
  lookup: InboundEmailHtmlLookup,
  fileId: string
): Promise<Buffer | null> {
  const file = await tenantDb(lookup.db, lookup.tenantId)
    .table('external_files')
    .where({ file_id: fileId, is_deleted: false })
    .first('storage_path', 'file_size');

  if (!file?.storage_path) {
    return null;
  }
  if (Number(file.file_size ?? 0) > MAX_RENDERABLE_EMAIL_SOURCE_BYTES) {
    return null;
  }

  const provider = await getStorageProvider();
  try {
    return await provider.download(file.storage_path);
  } catch (error) {
    // The row can outlive its object (retention sweep, a restore that skipped
    // the bucket, a half-finished upload). That is "no formatted view exists",
    // not a server error: a 500 would put a permanent failure message under
    // the body, where the contract is to withdraw the toggle.
    console.warn('[renderInboundEmailHtml] archived email source is unreadable', {
      tenant: lookup.tenantId,
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Resolve the `original_email` artifact for a message id and render it.
 * Returns null whenever no renderable artifact exists.
 */
export async function renderInboundEmailHtml(
  lookup: InboundEmailHtmlLookup
): Promise<string | null> {
  const forms = rfcMessageIdLookupForms(lookup.messageId);
  if (forms.length === 0) {
    return null;
  }

  const artifact = await tenantDb(lookup.db, lookup.tenantId)
    .table('email_processed_attachments')
    .where({
      provider_id: lookup.providerId,
      attachment_id: ORIGINAL_EMAIL_ATTACHMENT_ID,
      processing_status: 'success',
    })
    .modify((query: Knex.QueryBuilder) =>
      whereInboundEmailArtifactMessageId(query, lookup.messageId)
    )
    .whereNotNull('file_id')
    .first('email_id', 'file_id');

  if (!artifact?.file_id) {
    return null;
  }

  const rawMime = await readArchivedEmailSource(lookup, String(artifact.file_id));
  if (!rawMime?.length) {
    return null;
  }

  const mappings = await loadEmbeddedImageMappings(lookup, String(artifact.email_id));
  return buildInboundEmailHtmlFromMime(rawMime, mappings);
}
