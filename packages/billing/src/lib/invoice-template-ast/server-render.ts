import type { Knex } from 'knex';
import type { TemplateAst } from '@alga-psa/types';
import type { TemplateEvaluationResult } from './evaluator';
import { renderEvaluatedTemplateAst } from './react-renderer';
import { StorageProviderFactory, FileStoreModel } from '@alga-psa/storage';

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
}

// ---------------------------------------------------------------------------
// Image inlining
// ---------------------------------------------------------------------------

const DOC_VIEW_URL_RE = /\/api\/documents\/view\/([a-f0-9-]+)/gi;

/**
 * Find every `/api/documents/view/{fileId}` occurrence in `html`, read the
 * file directly from storage, and replace the URL with a `data:` URI.
 */
async function inlineDocumentImages(
  html: string,
  knex: Knex | Knex.Transaction,
): Promise<string> {
  // Collect unique file IDs referenced in the HTML.
  const fileIds = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = DOC_VIEW_URL_RE.exec(html)) !== null) {
    fileIds.add(match[1]);
  }

  if (fileIds.size === 0) return html;

  const provider = await StorageProviderFactory.createProvider();

  // Resolve each file to a data URI in parallel.
  const replacements = new Map<string, string>();

  await Promise.all(
    Array.from(fileIds).map(async (fileId) => {
      try {
        const file = await FileStoreModel.findById(knex, fileId);
        if (!file?.storage_path) return;
        const buffer = await provider.download(file.storage_path);
        const mime = file.mime_type || 'application/octet-stream';
        replacements.set(fileId, `data:${mime};base64,${buffer.toString('base64')}`);
      } catch {
        // Skip files that can't be resolved — the image will remain a URL
        // and render as a broken image, which is the existing behaviour.
      }
    }),
  );

  if (replacements.size === 0) return html;

  // Replace all occurrences (including query-string variants like `?t=...`).
  return html.replace(
    /\/api\/documents\/view\/([a-f0-9-]+)(\?[^"'\s)]*)?/gi,
    (fullMatch, id: string) => replacements.get(id) ?? fullMatch,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const renderTemplateAstHtmlDocument = async (
  ast: TemplateAst,
  evaluation: TemplateEvaluationResult,
  options: TemplateHtmlDocumentOptions = {}
): Promise<string> => {
  const { html, css } = await renderEvaluatedTemplateAst(ast, evaluation);
  const title = escapeHtml(options.title ?? 'Invoice');
  const additionalCss = options.additionalCss ?? '';
  const bodyClassName = options.bodyClassName ? ` class="${escapeHtml(options.bodyClassName)}"` : '';

  // When Puppeteer renders HTML via page.setContent(), the page origin is about:blank.
  // Relative URLs (e.g. /api/documents/view/...) cannot resolve without a base href.
  // Use NEXTAUTH_URL so that tenant logo and other API-served images load correctly.
  const baseUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || '';
  const baseTag = baseUrl ? `\n    <base href="${escapeHtml(baseUrl)}" />` : '';

  let renderedHtml = `<!doctype html>
<html lang="en">
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
    renderedHtml = await inlineDocumentImages(renderedHtml, options.knex);
  }

  return renderedHtml;
};

