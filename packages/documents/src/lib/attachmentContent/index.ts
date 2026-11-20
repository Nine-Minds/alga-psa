import { CallBudget, costOfBlocks } from './packer';
import { LIMITS, type ContentBudget, type LimitName } from './limits';
import { resolveEffectiveMime } from './mime';
import { createPdfPageRenderer } from './pdfRender';
import { fallbackUnits } from './producers/fallback';
import { inAppProducer, selectProducer } from './producers/registry';
import {
  ProducerUnreadable,
  type AttachmentSource,
  type ContentBlock,
  type Omission,
  type ProducerCtx,
  type ReadPosition,
  type ReadResult,
  type ServedRange,
  type UnitList,
} from './types';

export * from './types';
export * from './limits';
export * from './cursor';
export { selectProducer, PRODUCERS } from './producers/registry';
export { resolveEffectiveMime } from './mime';
export { normalizeImage } from './normalizeImage';
export { chunkText, decodeText } from './chunkText';

export interface ReadOptions {
  /** URI used in resource blobs and links: the document's in-app download URL. */
  documentUri?: (documentId: string) => string;
  /** Replaces the Ghostscript renderer (tests). */
  renderPdfPages?: ProducerCtx['renderPdfPages'];
  clock?: () => number;
}

interface OpenedDocument {
  list: UnitList;
  effectiveMime: string;
}

function memoize<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
}

const storedMime = (m: string | null) => (m ?? '').split(';')[0].trim().toLowerCase();

/**
 * Turn authorized attachments into MCP content blocks. `sources` are already authorized and in stable
 * order; the engine never sees a document the caller may not read. Walks the ordered stream of units from
 * `start`, materializing each and stopping before the unit that would exceed the budget. The first unit
 * of a call is always admitted, so every call makes progress.
 */
export async function readAttachmentContent(
  sources: AttachmentSource[],
  start: ReadPosition,
  budget: ContentBudget,
  options: ReadOptions = {},
): Promise<ReadResult> {
  const now = options.clock ?? Date.now;
  const documentUri = options.documentUri ?? ((id: string) => `/api/documents/${id}/download`);
  const callBudget = new CallBudget(budget, now);
  const disposers: Array<() => Promise<void> | void> = [];
  const onDispose = (fn: () => Promise<void> | void) => disposers.push(fn);

  const blocks: ContentBlock[] = [];
  const served: ServedRange[] = [];
  const omitted: Omission[] = [];
  const limits = new Set<LimitName>();
  let admittedAny = false;
  let next: ReadPosition | null = null;
  let remaining: string | null = null;

  const total = sources.length;
  let docIndex = start.docIndex;
  let unitIndex = start.unitIndex;

  try {
    while (docIndex < total) {
      const source = sources[docIndex];
      const doc = source.document;

      if (admittedAny && callBudget.deadlineReached()) {
        limits.add('deadline');
        next = { docIndex, unitIndex };
        remaining = describeRemaining(sources, docIndex, null, null);
        break;
      }

      const loadBytes = memoize(() => source.loadBytes());
      const tag = `[${docIndex + 1}/${total}] ${doc.document_name}`;
      const opened = await openDocument(source, loadBytes, { tag, documentUri, options, onDispose });
      const { list } = opened;

      let idx = Math.min(unitIndex, list.total);
      const firstIdx = idx;
      const renderings = new Set<string>();
      const scannedPages: number[] = [];
      let stopped = false;

      for (; idx < list.total; idx++) {
        const unit = list.unit(idx);
        if (admittedAny && callBudget.deadlineReached()) {
          limits.add('deadline');
          stopped = true;
          break;
        }
        if (admittedAny) {
          const limit = callBudget.check(await unit.cost());
          if (limit) {
            limits.add(limit);
            stopped = true;
            break;
          }
        }
        let out;
        try {
          out = await unit.materialize();
        } catch (error) {
          const detail = (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 160);
          out = await fallbackUnits(source, { tag, effectiveMime: opened.effectiveMime, mimeNote: null, documentUri, renderPdfPages: async () => [], onDispose }, 'unreadable', detail)
            .unit(0)
            .materialize();
        }
        const actual = costOfBlocks(out.blocks);
        if (admittedAny) {
          const limit = callBudget.check(actual);
          if (limit) {
            limits.add(limit);
            stopped = true;
            break;
          }
        }
        blocks.push({ type: 'text', text: out.label }, ...out.blocks);
        callBudget.add(actual);
        admittedAny = true;
        renderings.add(out.rendering);
        if (out.rendering === 'page_image' && out.page !== undefined && !out.omitted) scannedPages.push(out.page);
        if (out.omitted && out.rendering !== 'page_image') {
          omitted.push({ document_id: doc.document_id, name: doc.document_name, mime_type: opened.effectiveMime || null, reason: out.omitted.reason });
        } else if (out.omitted) {
          omitted.push({ document_id: doc.document_id, name: `${doc.document_name} (page ${out.page})`, mime_type: opened.effectiveMime || null, reason: out.omitted.reason });
        }
      }

      const servedTo = idx - 1;
      if (servedTo >= firstIdx) {
        served.push({
          docIndex,
          document_id: doc.document_id,
          name: doc.document_name,
          mime_type: opened.effectiveMime,
          part: list.describeRange(firstIdx, servedTo),
          rendering: renderingName(renderings),
          scanned_pages: scannedPages,
        });
      }

      if (stopped) {
        next = { docIndex, unitIndex: idx };
        remaining = describeRemaining(sources, docIndex, list, idx);
        break;
      }
      docIndex += 1;
      unitIndex = 0;
    }
  } finally {
    for (const fn of disposers.reverse()) {
      try {
        await fn();
      } catch {
        /* disposal is best-effort */
      }
    }
  }

  return { blocks, served, omitted, next, limitsApplied: [...limits], remaining };
}

function renderingName(set: Set<string>): string {
  const order = ['original', 'text', 'page_image', 'image', 'link'];
  return order.filter((k) => set.has(k)).join('+') || 'none';
}

function describeRemaining(sources: AttachmentSource[], docIndex: number, list: UnitList | null, unitIndex: number | null): string {
  const name = sources[docIndex].document.document_name;
  const first = list && unitIndex !== null && unitIndex > 0 && unitIndex < list.total ? `${list.describeRange(unitIndex, list.total - 1) ?? 'the rest'} of ${name}` : name;
  const more = sources.length - docIndex - 1;
  return `${first}${more > 0 ? `, then ${more} more attachment${more === 1 ? '' : 's'}` : ''}`;
}

async function openDocument(
  source: AttachmentSource,
  loadBytes: () => Promise<Buffer>,
  env: { tag: string; documentUri: (id: string) => string; options: ReadOptions; onDispose: (fn: () => Promise<void> | void) => void },
): Promise<OpenedDocument> {
  const doc = source.document;
  const baseCtx = (effectiveMime: string, mimeNote: string | null): ProducerCtx => ({
    tag: env.tag,
    effectiveMime,
    mimeNote,
    documentUri: env.documentUri,
    renderPdfPages: env.options.renderPdfPages ?? createPdfPageRenderer(env.onDispose),
    onDispose: env.onDispose,
  });
  const fallback = (mime: string, reason: string, detail?: string): OpenedDocument => ({
    effectiveMime: mime,
    list: fallbackUnits(source, baseCtx(mime, null), reason, detail),
  });

  if (!doc.file_id) {
    const ctx = baseCtx(storedMime(doc.mime_type) || 'text/markdown', null);
    try {
      return { effectiveMime: ctx.effectiveMime, list: await inAppProducer.units(source, Buffer.alloc(0), ctx) };
    } catch (error) {
      const reason = error instanceof ProducerUnreadable ? error.reason : 'unreadable';
      return fallback(ctx.effectiveMime, reason, error instanceof Error ? error.message : undefined);
    }
  }

  // Size gates run on documents.file_size BEFORE any download.
  const declaredSize = doc.file_size;
  const declaredMime = storedMime(doc.mime_type) || 'application/octet-stream';
  if (declaredSize !== null && Number.isFinite(declaredSize)) {
    const declaredProducer = selectProducer(declaredMime);
    if (declaredSize > LIMITS.maxAnyFileBytes || declaredSize > declaredProducer.maxBytes) {
      return fallback(declaredMime, 'too_large');
    }
  }

  let bytes: Buffer;
  try {
    bytes = await loadBytes();
  } catch (error) {
    return fallback(declaredMime, 'unreadable', error instanceof Error ? error.message.split('\n')[0].slice(0, 120) : undefined);
  }

  const { mime, note } = await resolveEffectiveMime(doc, bytes);
  const producer = selectProducer(mime);
  if (bytes.length > LIMITS.maxAnyFileBytes || bytes.length > producer.maxBytes) {
    return fallback(mime, 'too_large');
  }
  const ctx = baseCtx(mime, note);
  try {
    return { effectiveMime: mime, list: await producer.units(source, bytes, ctx) };
  } catch (error) {
    if (error instanceof ProducerUnreadable) return fallback(mime, error.reason, error.reason === 'encrypted_pdf' ? undefined : error.message.split('\n')[0].slice(0, 120));
    return fallback(mime, 'unreadable', error instanceof Error ? error.message.split('\n')[0].slice(0, 120) : undefined);
  }
}
export * from './source';
