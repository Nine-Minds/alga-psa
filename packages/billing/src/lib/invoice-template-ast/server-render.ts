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

export const renderInvoiceTemplateAstHtmlDocument = (
  ast: InvoiceTemplateAst,
  evaluation: InvoiceTemplateEvaluationResult,
  options: InvoiceTemplateHtmlDocumentOptions = {}
): string => {
  const { html, css } = renderEvaluatedInvoiceTemplateAst(ast, evaluation);
  const title = escapeHtml(options.title ?? 'Invoice');
  const additionalCss = options.additionalCss ?? '';
  const bodyClassName = options.bodyClassName ? ` class="${escapeHtml(options.bodyClassName)}"` : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
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
