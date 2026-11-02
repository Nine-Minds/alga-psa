import type { Knex } from 'knex';
import type { CountryDateFormat } from '@alga-psa/core/i18n/countryDateFormat';
import type { TemplateAst } from '@alga-psa/types';
import type { TemplateEvaluationResult } from './evaluator';
import { renderEvaluatedTemplateAst } from './react-renderer';
import { localizeTemplateAstForLocale } from './i18nLabels';
import { tenantDb } from '@alga-psa/db';
import { resolveCustomPageCssFromAst, type TemplatePreviewSheet } from './printSettings';
import { buildPreviewSheetCss, wrapInPreviewSheet } from './previewSheet';
import { StorageProviderFactory, FileStoreModel } from '@alga-psa/storage';
import type { FileStore } from '@alga-psa/storage';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export interface TemplateHtmlDocumentOptions {
  title?: string;
  additionalCss?: string;
  bodyClassName?: string;
  /**
   * When provided, `/api/documents/view/{fileId}` URLs in the rendered HTML
   * are replaced with inline base64 data URIs.  This is required for Puppeteer
   * PDF rendering because Puppeteer has no auth session and cannot fetch
   * protected document images from the API.
   */
  knex?: Knex | Knex.Transaction;
  /**
   * The recipient's locale. When set, template label keys are resolved against
   * it and the same locale formats numbers, dates and currency — one locale per
   * document, so the frame never disagrees with itself. Literal labels (every
   * customized template) are unaffected.
   */
  locale?: string;
  /**
   * The recipient country's date shape. Separate from the locale on purpose:
   * the country writes the digits (order, separator, 12/24h clock) and the
   * locale only names the months and weekdays, so a UK client of a US MSP reads
   * 30/09/2026 whatever language the document speaks.
   */
  dateFormat?: CountryDateFormat;
  /**
   * Screen preview only: draw the markup on a sheet the size of its printed page (see previewSheet.ts).
   * Never set on a path that produces a PDF.
   */
  previewSheet?: TemplatePreviewSheet;
}

// ---------------------------------------------------------------------------
// Image inlining
// ---------------------------------------------------------------------------

/**
 * Largest single file inlined as a `data:` URI. Inlined images ride along in the
 * HTML (and, for the portal preview, in a server-action response), and base64
 * adds ~33%, so this stays well below typical request limits. A logo or
 * designer image is a few hundred KB at most; 5 MiB leaves ample headroom for
 * high-resolution letterhead art. Larger files stay as URLs.
 */
export const MAX_INLINED_IMAGE_BYTES = 5 * 1024 * 1024;

const DOC_VIEW_ID_RE = /\/api\/documents\/view\/([a-f0-9-]+)/gi;
// Matches the URL plus an optional query string such as `?t=...`.
const DOC_VIEW_URL_RE = /\/api\/documents\/view\/([a-f0-9-]+)(\?[^"'\s)]*)?/gi;

export interface InlineDocumentImagesOptions {
  knex: Knex | Knex.Transaction;
  /**
   * When set, files are looked up with this tenant applied explicitly and a row
   * belonging to any other tenant is ignored. `FileStoreModel.findById` scopes
   * by the ambient tenant context rather than by the connection, so callers
   * that run for an untrusted viewer (client portal) must pass this.
   */
  tenant?: string;
  /**
   * What the single-value helpers (inlineDocumentImageUrl,
   * inlineTemplateImageSources) do with a document URL they could not inline.
   * 'keep' (default) leaves the URL. 'drop' blanks it so the renderer omits the
   * image: for a viewer the documents route would refuse (client portal), a
   * kept URL only renders as a broken image after a 403.
   */
  unresolved?: 'keep' | 'drop';
}

/**
 * Find every `/api/documents/view/{fileId}` occurrence in `text` (HTML or any
 * serialized value), read the file directly from storage, and replace the URL
 * with a `data:` URI. Only `image/*` files up to MAX_INLINED_IMAGE_BYTES are
 * inlined; anything else, and any file that cannot be resolved, stays a URL.
 */
export async function inlineDocumentImageUrls(
  text: string,
  options: InlineDocumentImagesOptions,
): Promise<string> {
  const { knex, tenant } = options;

  // Collect unique file IDs referenced in the text.
  const fileIds = new Set<string>();
  for (const match of text.matchAll(DOC_VIEW_ID_RE)) {
    fileIds.add(match[1]);
  }

  if (fileIds.size === 0) return text;

  let provider: Awaited<ReturnType<typeof StorageProviderFactory.createProvider>>;
  try {
    provider = await StorageProviderFactory.createProvider();
  } catch {
    // No storage available: nothing can be inlined, so every URL stays as is.
    return text;
  }

  // Resolve each file to a data URI in parallel.
  const replacements = new Map<string, string>();

  await Promise.all(
    Array.from(fileIds).map(async (fileId) => {
      try {
        // LEVERAGE: friction file-store-ambient-tenant — FileStoreModel.findById scopes by ambient
        // tenant context (AsyncLocalStorage), not by the connection/caller's tenant, so untrusted-viewer
        // paths must bypass it and query tenantDb(knex, tenant) directly. A tenant-explicit variant belongs in the model.
        const file = tenant
          ? await tenantDb(knex, tenant)
              .table<FileStore>('external_files')
              .where({ file_id: fileId, is_deleted: false })
              .first()
          : await FileStoreModel.findById(knex, fileId);
        if (!file?.storage_path) return;
        if (tenant && file.tenant !== tenant) return;

        const mime = (file.mime_type || '').toLowerCase();
        if (!mime.startsWith('image/')) return;
        if (Number(file.file_size) > MAX_INLINED_IMAGE_BYTES) return;

        const buffer = await provider.download(file.storage_path);
        // file_size is metadata; re-check the bytes actually read.
        if (buffer.length > MAX_INLINED_IMAGE_BYTES) return;
        replacements.set(fileId, `data:${mime};base64,${buffer.toString('base64')}`);
      } catch {
        // Skip files that can't be resolved — the image will remain a URL
        // and render as a broken image, which is the existing behaviour.
      }
    }),
  );

  if (replacements.size === 0) return text;

  // Replace all occurrences (including query-string variants like `?t=...`).
  return text.replace(
    DOC_VIEW_URL_RE,
    (fullMatch, id: string) => replacements.get(id) ?? fullMatch,
  );
}

// A value that is, in its entirety, a document view URL (optionally `?t=...`).
const WHOLE_DOC_VIEW_URL_RE = /^\/api\/documents\/view\/[a-f0-9-]+(\?[^"'\s)]*)?$/i;

/**
 * Inline a single image URL field. Only a value that is *entirely* a
 * `/api/documents/view/{id}` URL is touched; anything else is returned as is.
 *
 * Use this (not inlineDocumentImageUrls) for data a viewer can influence:
 * callers pick the specific MSP-authored fields to inline, so text such as a
 * client name or address containing a document URL is never resolved.
 */
export async function inlineDocumentImageUrl<T>(
  url: T,
  options: InlineDocumentImagesOptions,
): Promise<T | string | null> {
  if (typeof url !== 'string' || !WHOLE_DOC_VIEW_URL_RE.test(url)) return url;
  let inlined: string = url;
  try {
    inlined = await inlineDocumentImageUrls(url, options);
  } catch {
    // Treated as unresolved below.
  }
  if (inlined === url && options.unresolved === 'drop') return null;
  return inlined;
}

/**
 * Inline the `src` of every image node in a template AST whose `src` is a
 * literal document URL (what DocumentImagePickerWidget writes). No other
 * string in the AST is touched. Returns a copy; the input is not mutated.
 */
export async function inlineTemplateImageSources<T>(
  ast: T,
  options: InlineDocumentImagesOptions,
): Promise<T> {
  const pending: Array<() => Promise<void>> = [];

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== 'object') return value;
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      copy[key] = walk(child);
    }
    if (copy.type === 'image') {
      const src = copy.src as { type?: string; value?: unknown } | undefined;
      if (src && src.type === 'literal' && typeof src.value === 'string' && WHOLE_DOC_VIEW_URL_RE.test(src.value)) {
        const literal = { ...src };
        copy.src = literal;
        pending.push(async () => {
          // A dropped image becomes an empty src, which the renderer omits.
          literal.value = (await inlineDocumentImageUrl(src.value, options)) ?? '';
        });
      }
    }
    return copy;
  };

  const result = walk(ast) as T;
  await Promise.all(pending.map((run) => run()));
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a template to its body markup + CSS without the surrounding HTML document. Includes the
 * async barcode prepass (server-only; skipped with no library load when there is no barcode node).
 * Used by the document renderer below and by the label batch layer, which composes many fragments
 * into one document.
 */
export const renderTemplateAstFragment = async (
  ast: TemplateAst,
  evaluation: TemplateEvaluationResult,
  options: Pick<TemplateHtmlDocumentOptions, 'locale' | 'dateFormat'> = {}
): Promise<{ html: string; css: string; locale: string | undefined }> => {
  const { ast: localizedAst, locale, t } = await localizeTemplateAstForLocale(ast, options.locale);
  // Barcode prepass: async + server-only (qrcode / bwip-js are dynamically imported, never bundled
  // for the client). Skipped entirely, with no library load, when the template has no barcode node.
  const { renderBarcodeSvgs } = await import('./barcode/prepass.server');
  const barcodes = await renderBarcodeSvgs(localizedAst, evaluation, { locale });
  const { html, css } = await renderEvaluatedTemplateAst(localizedAst, evaluation, {
    barcodes,
    locale,
    dateFormat: options.dateFormat,
    t,
  });
  return { html, css, locale };
};

export const renderTemplateAstHtmlDocument = async (
  ast: TemplateAst,
  evaluation: TemplateEvaluationResult,
  options: TemplateHtmlDocumentOptions = {}
): Promise<string> => {
  const { html, css, locale } = await renderTemplateAstFragment(ast, evaluation, options);
  const title = escapeHtml(options.title ?? 'Invoice');
  // Custom page size: emit a real @page rule (preferCSSPageSize makes Chromium honour it).
  const customPageCss = resolveCustomPageCssFromAst(ast);
  const previewSheetCss = options.previewSheet ? buildPreviewSheetCss(options.previewSheet) : null;
  const additionalCss = [customPageCss, options.additionalCss, previewSheetCss].filter(Boolean).join('\n');
  const bodyHtml = options.previewSheet ? wrapInPreviewSheet(html, options.previewSheet) : html;
  const bodyClassName = options.bodyClassName ? ` class="${escapeHtml(options.bodyClassName)}"` : '';

  // When Puppeteer renders HTML via page.setContent(), the page origin is about:blank.
  // Relative URLs (e.g. /api/documents/view/...) cannot resolve without a base href.
  // Use NEXTAUTH_URL so that tenant logo and other API-served images load correctly.
  const baseUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || '';
  const baseTag = baseUrl ? `\n    <base href="${escapeHtml(baseUrl)}" />` : '';

  let renderedHtml = `<!doctype html>
<html lang="${escapeHtml(locale ?? 'en')}">
  <head>
    <meta charset="utf-8" />${baseTag}
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
${css}
${additionalCss}
    </style>
  </head>
  <body${bodyClassName}>
${bodyHtml}
  </body>
</html>`;

  // Inline document images as base64 so Puppeteer can render them without auth.
  if (options.knex) {
    renderedHtml = await inlineDocumentImageUrls(renderedHtml, { knex: options.knex });
  }

  return renderedHtml;
};

