/**
 * Pure `cid:`/`data:` source rewriting for inbound-email content.
 *
 * Extracted from `inboundEmbeddedImageUrlRewrite` so a reader-facing module can
 * use it without the BlockNote conversion that module also needs: importing
 * `@blocknote/server-util` into a Next route handler pulls React's
 * `createContext` into a server graph and the route fails to instantiate. The
 * functions here touch nothing but strings, so both the ingest pipeline and the
 * read-time renderer can share them.
 */

import type { EmbeddedImageUrlMapping } from './processInboundEmailArtifacts';

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
