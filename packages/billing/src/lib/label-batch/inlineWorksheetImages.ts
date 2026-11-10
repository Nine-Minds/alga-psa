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

function parseBlocks(content: unknown): Record<string, unknown>[] | null {
  if (isBlockList(content)) return content;
  if (typeof content !== 'string' || !content.trim().startsWith('[')) return null;
  try {
    const parsed: unknown = JSON.parse(content);
    return isBlockList(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function inlineBlocks(
  blocks: Record<string, unknown>[],
  resolve: WorksheetImageResolver,
  missingImageText: MissingImageText,
  counter: { missing: number }
): Promise<Record<string, unknown>[]> {
  return Promise.all(
    blocks.map(async (block) => {
      const children = isBlockList(block.children)
        ? await inlineBlocks(block.children, resolve, missingImageText, counter)
        : block.children;
      const next = children === block.children ? block : { ...block, children };
      if (block.type !== 'image') return next;

      const props = isRecord(block.props) ? block.props : {};
      const url = typeof props.url === 'string' ? props.url.trim() : '';
      if (!url || DATA_IMAGE_URL_RE.test(url)) return next;

      const documentPath = DOCUMENT_IMAGE_URL_RE.exec(url)?.[1];
      if (!documentPath && REMOTE_URL_RE.test(url)) return next;

      const inlined = documentPath ? await resolve(documentPath).catch(() => null) : null;
      if (inlined && DATA_IMAGE_URL_RE.test(inlined)) {
        return { ...next, props: { ...props, url: inlined } };
      }

      counter.missing += 1;
      const name = typeof props.name === 'string' && props.name.trim() ? props.name.trim() : null;
      return {
        type: 'paragraph',
        props: {},
        content: [{ type: 'text', text: missingImageText(name), styles: { italic: true } }],
        children: Array.isArray(children) ? children : [],
      };
    })
  );
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
  missingImageText: MissingImageText
): Promise<{ items: LabelPrintItem[]; missingImages: number }> {
  const counter = { missing: 0 };
  const next = await Promise.all(
    items.map(async (item) => {
      const blocks = parseBlocks(item.viewModel.ticketDescriptionRichText);
      if (!blocks) return item;
      const inlined = await inlineBlocks(blocks, resolve, missingImageText, counter);
      return { ...item, viewModel: { ...item.viewModel, ticketDescriptionRichText: inlined } };
    })
  );
  return { items: next, missingImages: counter.missing };
}
