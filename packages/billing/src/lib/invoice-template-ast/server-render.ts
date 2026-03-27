import type { InvoiceTemplateAst } from '@alga-psa/types';
import type { InvoiceTemplateEvaluationResult } from './evaluator';
import { renderEvaluatedInvoiceTemplateAst } from './react-renderer';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export interface InvoiceTemplateHtmlDocumentOptions {
  title?: string;
  additionalCss?: string;
  bodyClassName?: string;
}

export const renderInvoiceTemplateAstHtmlDocument = async (
  ast: InvoiceTemplateAst,
  evaluation: InvoiceTemplateEvaluationResult,
  options: InvoiceTemplateHtmlDocumentOptions = {}
): Promise<string> => {
  const { html, css } = await renderEvaluatedInvoiceTemplateAst(ast, evaluation);
  const title = escapeHtml(options.title ?? 'Invoice');
  const additionalCss = options.additionalCss ?? '';
  const bodyClassName = options.bodyClassName ? ` class="${escapeHtml(options.bodyClassName)}"` : '';

  // When Puppeteer renders HTML via page.setContent(), the page origin is about:blank.
  // Relative URLs (e.g. /api/documents/view/...) cannot resolve without a base href.
  // Use NEXTAUTH_URL so that tenant logo and other API-served images load correctly.
  const baseUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || '';
  const baseTag = baseUrl ? `\n    <base href="${escapeHtml(baseUrl)}" />` : '';

  return `<!doctype html>
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
};
