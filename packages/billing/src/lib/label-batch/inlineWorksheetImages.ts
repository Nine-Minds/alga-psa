import logger from '@alga-psa/core/logger';

import type { LabelPrintItem } from './renderLabelBatchHtml';

/**
 * Resolves one document image URL to a `data:image/...` URI, or null when it cannot (another tenant's
 * file, not an image, too large, storage unavailable).
 */
export type WorksheetImageResolver = (url: string) => Promise<string | null>;

/** The text printed where an image could not be included; `name` is the image's file name, if any. */
export type MissingImageText = (name: string | null) => string;

// `/api/documents/view/{fileId}` with an optional query, relative or on any origin: the bytes are read
// from storage for the printing tenant, never fetched over HTTP (Puppeteer has no session).
const DOCUMENT_IMAGE_URL_RE = /^(?:https?:\/\/[^/?#]+)?(\/api\/documents\/view\/[a-f0-9-]+(?:\?[^"'\s)]*)?)$/i;
const DATA_IMAGE_URL_RE = /^data:image\//i;
// Remote images are fetched by the isolated renderer (safeFetch) and print as their alt text if refused.
const REMOTE_URL_RE = /^https?:\/\//i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBlockList = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) && value.length > 0 && value.every((block) => isRecord(block) && typeof block.type === 'string');

/** Parsed rich content: a BlockNote block array or a ProseMirror `{type:'doc'}` document. */
type ParsedRichContent = { kind: 'blocks'; blocks: Record<string, unknown>[] } | { kind: 'doc'; doc: Record<string, unknown> };

function parseRichContent(content: unknown): ParsedRichContent | null {
  let parsed: unknown = content;
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (isBlockList(parsed)) return { kind: 'blocks', blocks: parsed };
  // The renderer (`convertBlockContentToHTML`) also renders ProseMirror docs; descriptions saved from
  // the rich editor arrive in that shape, so the inliner must walk them too or their images vanish.
  if (isRecord(parsed) && parsed.type === 'doc') return { kind: 'doc', doc: parsed };
  return null;
}

/** The printed stand-in for an image that could not be inlined, in the shape the surrounding content uses. */
function missingImageNode(kind: ParsedRichContent['kind'], name: string | null, text: string, children: unknown): Record<string, unknown> {
  return kind === 'doc'
    ? { type: 'paragraph', content: [{ type: 'text', text }] }
    : { type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: { italic: true } }], children };
}

/**
 * Deep-walks one value of parsed rich content and rewrites image nodes in either shape. BlockNote
 * images carry `props.url`; ProseMirror images carry `attrs.src` / `attrs.url` (the renderer maps
 * them to the same props). Walking every array/record generically covers `children` (BlockNote),
 * `content` (ProseMirror) and table `rows` / `cells` containers in both shapes. Unchanged nodes are
 * returned by identity so items without images stay byte-identical.
 */
async function inlineValue(
  value: unknown,
  kind: ParsedRichContent['kind'],
  resolve: WorksheetImageResolver,
  missingImageText: MissingImageText,
  counter: { missing: number },
  logContext: Record<string, unknown>
): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((entry) => inlineValue(entry, kind, resolve, missingImageText, counter, logContext)));
  }
  if (!isRecord(value)) return value;

  if (value.type === 'image') {
    const props = isRecord(value.props) ? value.props : {};
    const attrs = isRecord(value.attrs) ? value.attrs : {};
    const rawUrl = [props.url, attrs.src, attrs.url].find((v) => typeof v === 'string')?.trim() ?? '';
    const documentPath = rawUrl ? DOCUMENT_IMAGE_URL_RE.exec(rawUrl)?.[1] : undefined;
    // Embedded data: URIs print as is; remote URLs are the isolated renderer's job (alt text if refused).
    if (!rawUrl || DATA_IMAGE_URL_RE.test(rawUrl) || (!documentPath && REMOTE_URL_RE.test(rawUrl))) return value;

    let inlined: string | null = null;
    if (documentPath) {
      try {
        inlined = await resolve(documentPath);
      } catch (error) {
        // A storage failure must not masquerade as a missing file: log it, then print the marker.
        logger.warn('[inlineWorksheetDescriptionImages] Description image resolver failed', { ...logContext, url: documentPath, error });
      }
    }
    if (inlined && DATA_IMAGE_URL_RE.test(inlined)) {
      if (isRecord(value.props)) return { ...value, props: { ...props, url: inlined } };
      return { ...value, attrs: { ...attrs, src: inlined } };
    }
    counter.missing += 1;
    const named = [props.name, attrs.alt].find((v): v is string => typeof v === 'string' && v.trim().length > 0);
    const name = named?.trim() ?? null;
    return missingImageNode(kind, name, missingImageText(name), Array.isArray(value.children) ? value.children : []);
  }

  const next: Record<string, unknown> = { ...value };
  let changed = false;
  for (const key of Object.keys(value)) {
    const walked = await inlineValue(value[key], kind, resolve, missingImageText, counter, logContext);
    if (walked !== value[key]) {
      next[key] = walked;
      changed = true;
    }
  }
  return changed ? next : value;
}

/**
 * Puppeteer has no session, and the isolated-rendering step strips any image source that is not a
 * `data:` URI, so a pasted screenshot in a ticket description would silently vanish from the printed
 * worksheet. This inlines each description image through `resolve` (scoped to the printing tenant by
 * the caller) and replaces any image it cannot inline with a visible marker, counting them so the
 * print dialog can say so. Only image blocks are touched; items without rich content are returned as is.
 */
export async function inlineWorksheetDescriptionImages(
  items: readonly LabelPrintItem[],
  resolve: WorksheetImageResolver,
  missingImageText: MissingImageText,
  logContext: Record<string, unknown> = {}
): Promise<{ items: LabelPrintItem[]; missingImages: number }> {
  const counter = { missing: 0 };
  const resolvedByDocumentId = new Map<string, Promise<string | null>>();
  const resolveOncePerDocument: WorksheetImageResolver = (url) => {
    const documentId = /\/api\/documents\/view\/([a-f0-9-]+)/i.exec(url)?.[1];
    if (!documentId) return resolve(url);
    let pending = resolvedByDocumentId.get(documentId);
    if (!pending) {
      pending = resolve(url);
      resolvedByDocumentId.set(documentId, pending);
    }
    return pending;
  };
  const next = await Promise.all(
    items.map(async (item) => {
      const content = parseRichContent(item.viewModel.ticketDescriptionRichText);
      if (!content) return item;
      const source = content.kind === 'blocks' ? content.blocks : content.doc;
      const inlined = await inlineValue(source, content.kind, resolveOncePerDocument, missingImageText, counter, {
        ...logContext,
        recordId: item.viewModel.recordId,
      });
      if (inlined === source) return item;
      return { ...item, viewModel: { ...item.viewModel, ticketDescriptionRichText: inlined } };
    })
  );
  return { items: next, missingImages: counter.missing };
}
