/**
 * Shared embedded-image URL rewriting for persisted inbound-email bodies.
 *
 * Inbound raw MIME is parsed with `keepCidLinks` so `<img src="cid:...">`
 * survives into the block body. The attachments pipeline later persists those
 * inline images and reports `embeddedImageUrlMappings`; this module applies
 * those mappings to the stored bodies (`comments.note` and
 * `tickets.attributes.description`).
 *
 * The same helper serves the in-app path (which still has the original HTML)
 * and the durable artifact worker (which re-parses the staged MIME). It is
 * idempotent: applying it twice produces no change and never appends a second
 * image block. It also preserves human edits — content that no longer matches
 * what this pipeline wrote is only touched in place, and only while an
 * unresolved `cid:` that matches a mapping remains.
 */

import { convertHtmlToBlockNote, convertMarkdownToBlocks } from '../../lib/utils/contentConversion';
import type { EmbeddedImageUrlMapping } from './processInboundEmailArtifacts';
import { withTenantAdminTransaction } from './tenantAdminTransaction';

export function normalizeEmbeddedContentId(value: string | undefined | null): string {
  if (!value) return '';
  return String(value).trim().replace(/^cid:/i, '').replace(/^<|>$/g, '').toLowerCase();
}

/**
 * Replace `cid:` and inline `data:image` sources that match persisted
 * mappings. Operates on any string that carries the source (HTML or the
 * serialized BlockNote body), which is why the durable worker can reuse it
 * without re-deriving the block shape.
 */
export function rewriteEmbeddedImageSourcesInContent(
  content: string,
  embeddedMappings: EmbeddedImageUrlMapping[]
): string {
  if (!content || !embeddedMappings.length) return content;

  const dataUrlMap = new Map<string, string>();
  const cidMap = new Map<string, string>();

  for (const mapping of embeddedMappings) {
    if (mapping.source === 'data-url') {
      dataUrlMap.set(mapping.reference, mapping.url);
      continue;
    }

    if (mapping.source === 'cid') {
      const normalized = normalizeEmbeddedContentId(mapping.reference);
      if (normalized) {
        cidMap.set(normalized, mapping.url);
      }
    }
  }

  let rewritten = content;

  if (dataUrlMap.size > 0) {
    rewritten = rewritten.replace(
      /data:(image\/[a-z0-9.+-]+);base64,([^"'<>]+)/gim,
      (fullMatch: string, contentType: string, base64: string) => {
        const normalized = `data:${String(contentType).toLowerCase()};base64,${String(base64).replace(/\s+/g, '')}`;
        return dataUrlMap.get(normalized) || fullMatch;
      }
    );
  }

  if (cidMap.size > 0) {
    rewritten = rewritten.replace(/\bcid:([^"'<>\s)]+)/gim, (fullMatch: string, cid: string) => {
      const normalized = normalizeEmbeddedContentId(cid);
      return cidMap.get(normalized) || fullMatch;
    });
  }

  return rewritten;
}

/**
 * Append image blocks for mappings whose served URL is not already present.
 * Run after the `src` rewrite so a mapping resolved in place is not appended a
 * second time.
 */
export function preserveEmbeddedImageUrlBlocks(
  blocks: unknown[],
  embeddedMappings: EmbeddedImageUrlMapping[]
): unknown[] {
  if (!embeddedMappings.length) {
    return blocks;
  }

  const serializedBlocks = JSON.stringify(blocks);
  const missingMappings = embeddedMappings.filter((mapping) => (
    mapping.url && !serializedBlocks.includes(mapping.url)
  ));

  if (!missingMappings.length) {
    return blocks;
  }

  return [
    ...blocks,
    ...missingMappings.map((mapping) => ({
      type: 'image',
      props: {
        url: mapping.url,
        name: mapping.fileId || mapping.documentId || 'embedded-image',
        caption: '',
      },
    })),
  ];
}

function blocksFallbackFromText(text: string) {
  return [
    {
      type: 'paragraph',
      content: [{ type: 'text', text, styles: {} }],
    },
  ];
}

export async function blocksFromEmailBody(params: {
  html?: string;
  text?: string;
}): Promise<unknown[]> {
  const html = params.html?.trim();
  const text = params.text?.trim();

  if (html) {
    try {
      const blocks = await convertHtmlToBlockNote(html, { flattenTables: true });
      return blocks.length ? blocks : blocksFallbackFromText(text ?? '');
    } catch {
      return blocksFallbackFromText(text ?? '');
    }
  }

  if (text) {
    try {
      const blocks = convertMarkdownToBlocks(text);
      return blocks.length ? blocks : blocksFallbackFromText(text);
    } catch {
      return blocksFallbackFromText(text);
    }
  }

  return blocksFallbackFromText('');
}

export type EmbeddedImageBodyTargetKind = 'comment' | 'ticket-description';

export interface EmbeddedImageBodyTarget {
  kind: EmbeddedImageBodyTargetKind;
  /** `comment_id` for comments, `ticket_id` for ticket descriptions. */
  id: string;
  /**
   * Content this pipeline originally persisted for the target, when known.
   * Used to distinguish pipeline-authored content (safe to replace wholesale)
   * from later human edits (rewritten in place only).
   */
  originalContent?: string;
}

export interface ApplyEmbeddedImageMappingsArgs {
  tenantId: string;
  html?: string;
  text?: string;
  mappings: EmbeddedImageUrlMapping[];
  targets: EmbeddedImageBodyTarget[];
}

function parseTicketAttributes(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

interface BodyAccessor {
  read: (db: any) => Promise<string | null>;
  write: (db: any, content: string) => Promise<void>;
}

function commentAccessor(commentId: string): BodyAccessor {
  return {
    read: async (db: any) => {
      const row = await db.table('comments').where({ comment_id: commentId }).first('note');
      return row?.note ?? null;
    },
    write: async (db: any, content: string) => {
      await db.table('comments')
        .where({ comment_id: commentId })
        .update({ note: content, updated_at: new Date() });
    },
  };
}

function ticketDescriptionAccessor(ticketId: string): BodyAccessor {
  return {
    read: async (db: any) => {
      const row = await db.table('tickets').where({ ticket_id: ticketId }).first('attributes');
      if (!row) return null;
      const description = parseTicketAttributes(row.attributes).description;
      return typeof description === 'string' ? description : null;
    },
    write: async (db: any, content: string) => {
      const row = await db.table('tickets').where({ ticket_id: ticketId }).first('attributes');
      if (!row) return;
      const attributes = parseTicketAttributes(row.attributes);
      attributes.description = content;
      await db.table('tickets')
        .where({ ticket_id: ticketId })
        .update({ attributes: JSON.stringify(attributes), updated_at: new Date() });
    },
  };
}

/**
 * Apply persisted embedded-image mappings to stored bodies.
 *
 * A target is only rewritten when the stored body still equals the content
 * this pipeline wrote, or still contains an unresolved `cid:` that matches a
 * mapping. Edited content is patched in place; it is never replaced wholesale
 * and no second image block is appended once the served URL is present.
 * Best-effort: a failure on one target is logged and does not affect others or
 * the caller's disposition.
 */
export async function applyEmbeddedImageUrlMappingsToStoredBodies(
  args: ApplyEmbeddedImageMappingsArgs
): Promise<void> {
  const mappings = args.mappings ?? [];
  if (!mappings.length || !args.targets.length) {
    return;
  }

  let wholesaleContent: string | null = null;
  if (args.html) {
    const rewrittenHtml = rewriteEmbeddedImageSourcesInContent(args.html, mappings);
    if (rewrittenHtml !== args.html) {
      const rewrittenBlocks = preserveEmbeddedImageUrlBlocks(
        await blocksFromEmailBody({ html: rewrittenHtml, text: args.text }),
        mappings
      );
      wholesaleContent = JSON.stringify(rewrittenBlocks);
    }
  }

  for (const target of args.targets) {
    const accessor = target.kind === 'comment'
      ? commentAccessor(target.id)
      : ticketDescriptionAccessor(target.id);

    try {
      await withTenantAdminTransaction(args.tenantId, async (_trx: any, db: any) => {
        const current = await accessor.read(db);
        if (!current) return;

        let next: string;
        if (
          target.originalContent !== undefined
          && current === target.originalContent
          && wholesaleContent
        ) {
          next = wholesaleContent;
        } else {
          next = rewriteEmbeddedImageSourcesInContent(current, mappings);
        }

        if (next === current) return;
        await accessor.write(db, next);
      });
    } catch (error) {
      console.warn('inboundEmbeddedImageUrlRewrite: stored body rewrite failed (continuing)', {
        tenantId: args.tenantId,
        targetKind: target.kind,
        targetId: target.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
