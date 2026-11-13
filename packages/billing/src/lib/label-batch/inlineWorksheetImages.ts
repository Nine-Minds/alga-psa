import logger from '@alga-psa/core/logger';

import type { LabelPrintItem } from './renderLabelBatchHtml';

/**
 * Resolves one document image path to a `data:image/...` URI. Returns null when the file legitimately
 * cannot be inlined (another tenant's file, not an image, too large, gone) and throws when storage or
 * the database fails, so an outage is reported apart from a missing file.
 */
export type WorksheetImageResolver = (url: string) => Promise<string | null>;

/** The text printed where an image could not be included; `name` is the image's file name, if any. */
export type MissingImageText = (name: string | null) => string;

export interface InlineWorksheetImagesOptions {
  /**
   * The application's own base URL. An absolute `/api/documents/view/{id}` URL is read from storage
   * only when it is on this origin; on any other origin it is a remote image. Without a base URL only
   * relative document paths are read from storage.
   */
  baseUrl?: string | null;
  logContext?: Record<string, unknown>;
}

export interface InlineWorksheetImagesResult {
  items: LabelPrintItem[];
  /** Images printed as a marker because the file is missing or not inlinable. */
  missingImages: number;
  /** Images printed as a marker because reading them from storage failed. */
  unavailableImages: number;
}

// Distinct documents read from storage at once; a description can reference many images.
const MAX_CONCURRENT_RESOLVES = 4;

// `/api/documents/view/{fileId}` with an optional query, relative or absolute: the bytes are read
// from storage for the printing tenant, never fetched over HTTP (Puppeteer has no session).
const DOCUMENT_IMAGE_URL_RE = /^(https?:\/\/[^/?#]+)?(\/api\/documents\/view\/[a-f0-9-]+(?:\?[^"'\s)]*)?)$/i;
const DATA_IMAGE_URL_RE = /^data:image\//i;
// Remote images are fetched by the isolated renderer (safeFetch) and print as their alt text if refused.
const REMOTE_URL_RE = /^https?:\/\//i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBlockList = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) && value.length > 0 && value.every((block) => isRecord(block) && typeof block.type === 'string');

/** Parsed rich content: a BlockNote block array or a ProseMirror `{type:'doc'}` document. */
type ParsedRichContent = { kind: 'blocks'; blocks: Record<string, unknown>[] } | { kind: 'doc'; doc: Record<string, unknown> };

type ImageOutcome = { status: 'inlined'; dataUrl: string } | { status: 'missing' } | { status: 'unavailable' };

interface WalkState {
  kind: ParsedRichContent['kind'];
  resolveImage: (documentPath: string) => Promise<ImageOutcome>;
  documentPathOf: (url: string) => string | undefined;
  missingImageText: MissingImageText;
  counter: { missing: number; unavailable: number };
}

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

function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin.toLowerCase();
  } catch {
    throw new Error(`Invalid application base URL for worksheet image inlining: "${baseUrl}"`);
  }
}

/** A tiny FIFO limiter: at most `limit` tasks run at once. */
function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= limit) return;
    const start = queue.shift();
    if (start) start();
  };
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
}

/** The printed stand-in for an image that could not be inlined, in the shape the surrounding content uses. */
function missingImageNode(kind: ParsedRichContent['kind'], text: string, children: unknown): Record<string, unknown> {
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
async function inlineValue(value: unknown, state: WalkState): Promise<unknown> {
  if (Array.isArray(value)) {
    const walked = await Promise.all(value.map((entry) => inlineValue(entry, state)));
    return walked.every((entry, index) => entry === value[index]) ? value : walked;
  }
  if (!isRecord(value)) return value;

  if (value.type === 'image') {
    const props = isRecord(value.props) ? value.props : {};
    const attrs = isRecord(value.attrs) ? value.attrs : {};
    const rawUrl = [props.url, attrs.src, attrs.url].find((v) => typeof v === 'string')?.trim() ?? '';
    const documentPath = rawUrl ? state.documentPathOf(rawUrl) : undefined;
    // Embedded data: URIs print as is; remote URLs are the isolated renderer's job (alt text if refused).
    if (!rawUrl || DATA_IMAGE_URL_RE.test(rawUrl) || (!documentPath && REMOTE_URL_RE.test(rawUrl))) return value;

    const outcome: ImageOutcome = documentPath ? await state.resolveImage(documentPath) : { status: 'missing' };
    if (outcome.status === 'inlined') {
      if (isRecord(value.props)) return { ...value, props: { ...props, url: outcome.dataUrl } };
      // Overwrite every attribute that may carry the URL so no document URL is left behind.
      return {
        ...value,
        attrs: { ...attrs, src: outcome.dataUrl, ...(typeof attrs.url === 'string' ? { url: outcome.dataUrl } : {}) },
      };
    }
    if (outcome.status === 'unavailable') state.counter.unavailable += 1;
    else state.counter.missing += 1;
    const named = [props.name, attrs.alt].find((v): v is string => typeof v === 'string' && v.trim().length > 0);
    const name = named?.trim() ?? null;
    return missingImageNode(state.kind, state.missingImageText(name), Array.isArray(value.children) ? value.children : []);
  }

  const next: Record<string, unknown> = { ...value };
  let changed = false;
  for (const key of Object.keys(value)) {
    const walked = await inlineValue(value[key], state);
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
 * the caller) and replaces any image it cannot inline with a visible marker. Missing files and storage
 * failures are counted separately so the print dialog can say which happened. Only image blocks are
 * touched; items without rich content are returned as is.
 */
export async function inlineWorksheetDescriptionImages(
  items: readonly LabelPrintItem[],
  resolve: WorksheetImageResolver,
  missingImageText: MissingImageText,
  options: InlineWorksheetImagesOptions = {}
): Promise<InlineWorksheetImagesResult> {
  const logContext = options.logContext ?? {};
  const ownOrigin = options.baseUrl ? originOf(options.baseUrl) : null;
  const documentPathOf = (url: string): string | undefined => {
    const match = DOCUMENT_IMAGE_URL_RE.exec(url);
    if (!match) return undefined;
    const [, origin, path] = match;
    // A document URL on another host names that host's document, never this tenant's.
    if (origin && origin.toLowerCase() !== ownOrigin) return undefined;
    return path;
  };

  const limit = createLimiter(MAX_CONCURRENT_RESOLVES);
  const outcomeByDocumentId = new Map<string, Promise<ImageOutcome>>();
  const resolveOnce = (documentPath: string, recordId: unknown): Promise<ImageOutcome> => {
    const documentId = /\/api\/documents\/view\/([a-f0-9-]+)/i.exec(documentPath)![1].toLowerCase();
    let pending = outcomeByDocumentId.get(documentId);
    if (!pending) {
      pending = limit(() => resolve(documentPath)).then(
        (dataUrl): ImageOutcome =>
          dataUrl && DATA_IMAGE_URL_RE.test(dataUrl) ? { status: 'inlined', dataUrl } : { status: 'missing' },
        (error): ImageOutcome => {
          // A storage failure must not masquerade as a missing file: log it and count it apart.
          logger.warn('[inlineWorksheetDescriptionImages] Description image could not be read from storage', {
            ...logContext,
            recordId,
            url: documentPath,
            error,
          });
          return { status: 'unavailable' };
        }
      );
      outcomeByDocumentId.set(documentId, pending);
    }
    return pending;
  };

  const counter = { missing: 0, unavailable: 0 };
  const next = await Promise.all(
    items.map(async (item) => {
      const content = parseRichContent(item.viewModel.ticketDescriptionRichText);
      if (!content) return item;
      const source = content.kind === 'blocks' ? content.blocks : content.doc;
      const inlined = await inlineValue(source, {
        kind: content.kind,
        resolveImage: (documentPath) => resolveOnce(documentPath, item.viewModel.recordId),
        documentPathOf,
        missingImageText,
        counter,
      });
      if (inlined === source) return item;
      return { ...item, viewModel: { ...item.viewModel, ticketDescriptionRichText: inlined } };
    })
  );
  return { items: next, missingImages: counter.missing, unavailableImages: counter.unavailable };
}
