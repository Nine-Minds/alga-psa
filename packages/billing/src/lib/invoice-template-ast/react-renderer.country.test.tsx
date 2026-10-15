import { describe, expect, it } from 'vitest';
import { countryDateFormat } from '@alga-psa/core/i18n/countryDateFormat';

import { evaluateTemplateAst } from './evaluator';
import { renderEvaluatedTemplateAst } from './react-renderer';
import { getStandardTemplateAstByCode, STANDARD_INVOICE_DEFAULT_CODE } from './standardTemplates';
import { INVOICE_TEMPLATE_BINDING_ALIASES } from './bindingAliases';
import {
  getStandardQuoteTemplateAstByCode,
  STANDARD_QUOTE_DEFAULT_CODE,
} from '../quote-template-ast/standardTemplates';

/**
 * The document a client receives is dated the way THEY write dates. These pin
 * the rendered digits themselves, because the plumbing between the resolved
 * country and the invoice/quote HTML is what regressed before: tables flipped
 * with the country while invoices and quotes stayed US-shaped.
 */

const invoiceFixture = {
  invoiceNumber: 'INV-2042',
  issueDate: '2026-09-30',
  dueDate: '2026-10-15',
  subtotal: 10000,
  tax: 0,
  total: 10000,
  items: [],
};

const quoteFixture = {
  quote_number: 'Q-77',
  quote_date: '2026-09-30',
  valid_until: '2026-10-15',
  line_items: [],
};

const renderInvoice = async (country: string | null, locale = 'en') => {
  const ast = getStandardTemplateAstByCode(STANDARD_INVOICE_DEFAULT_CODE);
  if (!ast) throw new Error('Standard invoice template missing');
  const evaluation = evaluateTemplateAst(ast, invoiceFixture, {
    bindingAliases: INVOICE_TEMPLATE_BINDING_ALIASES,
  });
  const { html } = await renderEvaluatedTemplateAst(ast, evaluation, {
    locale,
    dateFormat: countryDateFormat(country),
  });
  return html;
};

const renderQuote = async (country: string | null, locale = 'en') => {
  const ast = getStandardQuoteTemplateAstByCode(STANDARD_QUOTE_DEFAULT_CODE);
  if (!ast) throw new Error('Standard quote template missing');
  const evaluation = evaluateTemplateAst(ast, quoteFixture);
  const { html } = await renderEvaluatedTemplateAst(ast, evaluation, {
    locale,
    dateFormat: countryDateFormat(country),
  });
  return html;
};

describe('invoice rendering by recipient country', () => {
  it('writes the issue and due dates in the country order', async () => {
    expect(await renderInvoice('GB')).toContain('30/09/2026');
    expect(await renderInvoice('GB')).toContain('15/10/2026');
    expect(await renderInvoice('DE')).toContain('30.09.2026');
    expect(await renderInvoice('US')).toContain('09/30/2026');
  });

  it("falls back to the system default for 'XX' and an absent country", async () => {
    expect(await renderInvoice('XX')).toContain('09/30/2026');
    expect(await renderInvoice(null)).toContain('09/30/2026');
  });

  it('keeps the country order when the document is written in another language', async () => {
    const french = await renderInvoice('GB', 'fr');
    expect(french).toContain('30/09/2026');
    expect(french).not.toContain('09/30/2026');
  });
});

describe('quote rendering by recipient country', () => {
  it('writes the quote and validity dates in the country order', async () => {
    expect(await renderQuote('GB')).toContain('30/09/2026');
    expect(await renderQuote('DE')).toContain('15.10.2026');
    expect(await renderQuote('US')).toContain('09/30/2026');
  });

  it("falls back to the system default for 'XX'", async () => {
    expect(await renderQuote('XX')).toContain('09/30/2026');
  });
});
