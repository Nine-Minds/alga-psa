import type { Knex } from 'knex';
import type { CountryDateFormat } from '@alga-psa/core/i18n/countryDateFormat';
import type { TemplateAst } from '@alga-psa/types';
import type { TemplateEvaluationResult } from './evaluator';
import { renderEvaluatedTemplateAst } from './react-renderer';
import { localizeTemplateAstForLocale } from './i18nLabels';
import { tenantDb } from '@alga-psa/db';
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

  const provider = await StorageProviderFactory.createProvider();

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

/**
 * Same as inlineDocumentImageUrls but for structured values (invoice view
 * models, template ASTs): inlines every document URL found in any string.
 * Data URIs contain no JSON metacharacters, so the serialize/replace/parse
 * round trip is lossless.
 */
export async function inlineDocumentImagesInValue<T>(
  value: T,
  options: InlineDocumentImagesOptions,
): Promise<T> {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return value;
  const inlined = await inlineDocumentImageUrls(serialized, options);
  return inlined === serialized ? value : (JSON.parse(inlined) as T);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const renderTemplateAstHtmlDocument = async (
  ast: TemplateAst,
  evaluation: TemplateEvaluationResult,
  options: TemplateHtmlDocumentOptions = {}
): Promise<string> => {
  const { ast: localizedAst, locale, t } = await localizeTemplateAstForLocale(ast, options.locale);
  const { html, css } = await renderEvaluatedTemplateAst(localizedAst, evaluation, {
    locale,
    dateFormat: options.dateFormat,
    t,
  });
  const title = escapeHtml(options.title ?? 'Invoice');
  const additionalCss = options.additionalCss ?? '';
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
${html}
  </body>
</html>`;

  // Inline document images as base64 so Puppeteer can render them without auth.
  if (options.knex) {
    renderedHtml = await inlineDocumentImageUrls(renderedHtml, { knex: options.knex });
  }

  return renderedHtml;
};

