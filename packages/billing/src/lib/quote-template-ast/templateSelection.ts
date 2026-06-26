import type { TemplateAst, IQuote } from '@alga-psa/types';
import type { Knex } from 'knex';

import Quote from '../../models/quote';
import {
  STANDARD_QUOTE_BY_LOCATION_CODE,
  STANDARD_QUOTE_DEFAULT_CODE,
  getStandardQuoteTemplateAstByCode,
} from './standardTemplates';

/**
 * Count distinct non-null location_ids on a quote's items. Used to decide
 * whether the standard-fallback template should auto-branch to the
 * per-location layout.
 */
function countDistinctItemLocations(quote: IQuote): number {
  const items = quote.quote_items ?? [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.location_id) seen.add(item.location_id);
  }
  return seen.size;
}

const cloneAst = (ast: TemplateAst): TemplateAst =>
  JSON.parse(JSON.stringify(ast)) as TemplateAst;

/**
 * Bindings whose resolved value is rich HTML (authored in the WYSIWYG editor)
 * and must therefore be rendered as sanitized markup instead of escaped text.
 */
const RICH_TEXT_BINDING_IDS = new Set(['scope']);

type MutableTemplateNode = {
  type?: string;
  content?: { type?: string; bindingId?: string } | unknown;
  richText?: boolean;
  children?: unknown;
};

/**
 * Walk the template AST and flag every `text` node bound to a rich-text
 * binding (e.g. `scope`) with `richText: true`. This guarantees stored
 * templates (seeded standard templates or custom tenant templates) render the
 * quote scope as HTML, even if their persisted AST predates the flag.
 */
const markRichTextNodes = (node: unknown): void => {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      markRichTextNodes(child);
    }
    return;
  }

  const candidate = node as MutableTemplateNode;
  const content = candidate.content as { type?: string; bindingId?: string } | undefined;
  if (
    candidate.type === 'text' &&
    content &&
    content.type === 'binding' &&
    typeof content.bindingId === 'string' &&
    RICH_TEXT_BINDING_IDS.has(content.bindingId)
  ) {
    candidate.richText = true;
  }

  if (candidate.children) {
    markRichTextNodes(candidate.children);
  }
};

/**
 * Walk the template AST and flag every `text` node bound to a rich-text
 * binding (e.g. `scope`) with `richText: true`. This guarantees stored
 * templates (seeded standard templates or custom tenant templates) render the
 * quote scope as HTML, even if their persisted AST predates the flag.
 */
export const markQuoteRichTextNodes = (ast: TemplateAst): TemplateAst => {
  markRichTextNodes(ast.layout);
  return ast;
};

const normalizeResolvedQuoteTemplate = (resolved: ResolvedQuoteTemplate): ResolvedQuoteTemplate => {
  markQuoteRichTextNodes(resolved.templateAst);
  return resolved;
};

const getCustomTemplateAst = async (
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  templateId: string
): Promise<TemplateAst | null> => {
  const record = await knexOrTrx('quote_document_templates')
    .select('templateAst')
    .where({ tenant, template_id: templateId })
    .first<{ templateAst?: TemplateAst | null }>();

  return record?.templateAst ? cloneAst(record.templateAst) : null;
};

const getStandardTemplateAst = async (
  knexOrTrx: Knex | Knex.Transaction,
  code: string
): Promise<TemplateAst | null> => {
  const record = await knexOrTrx('standard_quote_document_templates')
    .select('templateAst')
    .where({ standard_quote_document_template_code: code })
    .first<{ templateAst?: TemplateAst | null }>();

  if (record?.templateAst) {
    return cloneAst(record.templateAst);
  }

  return getStandardQuoteTemplateAstByCode(code);
};

const getStandardTemplateAstByTemplateId = async (
  knexOrTrx: Knex | Knex.Transaction,
  templateId: string
): Promise<{ templateAst: TemplateAst; standardCode: string } | null> => {
  const record = await knexOrTrx('standard_quote_document_templates')
    .select('templateAst', 'standard_quote_document_template_code')
    .where({ template_id: templateId })
    .first<{ templateAst?: TemplateAst | null; standard_quote_document_template_code?: string }>();

  if (record?.templateAst && record.standard_quote_document_template_code) {
    return {
      templateAst: cloneAst(record.templateAst),
      standardCode: record.standard_quote_document_template_code,
    };
  }

  return null;
};

export interface ResolvedQuoteTemplate {
  templateAst: TemplateAst;
  source: 'quote' | 'tenant-default' | 'standard-fallback';
  templateId?: string;
  standardCode?: string;
}

export async function resolveQuoteTemplateAst(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteOrId: IQuote | string
): Promise<ResolvedQuoteTemplate> {
  const resolved = await resolveQuoteTemplateAstInternal(knexOrTrx, tenant, quoteOrId);
  return normalizeResolvedQuoteTemplate(resolved);
}

async function resolveQuoteTemplateAstInternal(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  quoteOrId: IQuote | string
): Promise<ResolvedQuoteTemplate> {
  const quote =
    typeof quoteOrId === 'string' ? await Quote.getById(knexOrTrx, tenant, quoteOrId) : quoteOrId;

  if (!quote) {
    throw new Error('Quote not found while resolving document template');
  }

  if (quote.template_id) {
    const customAst = await getCustomTemplateAst(knexOrTrx, tenant, quote.template_id);
    if (customAst) {
      return {
        templateAst: customAst,
        source: 'quote',
        templateId: quote.template_id,
      };
    }

    const standardMatch = await getStandardTemplateAstByTemplateId(knexOrTrx, quote.template_id);
    if (standardMatch) {
      return {
        templateAst: standardMatch.templateAst,
        source: 'quote',
        templateId: quote.template_id,
        standardCode: standardMatch.standardCode,
      };
    }
  }

  const tenantAssignment = await knexOrTrx('quote_document_template_assignments')
    .select('template_source', 'standard_quote_document_template_code', 'quote_document_template_id')
    .where({ tenant, scope_type: 'tenant' })
    .whereNull('scope_id')
    .first<{
      template_source?: 'standard' | 'custom';
      standard_quote_document_template_code?: string | null;
      quote_document_template_id?: string | null;
    }>();

  if (tenantAssignment?.template_source === 'custom' && tenantAssignment.quote_document_template_id) {
    const customAst = await getCustomTemplateAst(
      knexOrTrx,
      tenant,
      tenantAssignment.quote_document_template_id
    );

    if (customAst) {
      return {
        templateAst: customAst,
        source: 'tenant-default',
        templateId: tenantAssignment.quote_document_template_id,
      };
    }
  }

  if (tenantAssignment?.template_source === 'standard' && tenantAssignment.standard_quote_document_template_code) {
    const standardAst = await getStandardTemplateAst(
      knexOrTrx,
      tenantAssignment.standard_quote_document_template_code
    );

    if (standardAst) {
      return {
        templateAst: standardAst,
        source: 'tenant-default',
        standardCode: tenantAssignment.standard_quote_document_template_code,
      };
    }
  }

  // Auto-branch: when no explicit (per-quote or tenant-level) template is
  // chosen, pick the multi-location standard template when the quote spans
  // ≥2 distinct locations; otherwise keep the flat default. Custom templates
  // are explicitly NOT auto-swapped — they only pick up the new binding if
  // their authors opt in.
  const distinctLocations = countDistinctItemLocations(quote);
  const fallbackCode = distinctLocations >= 2
    ? STANDARD_QUOTE_BY_LOCATION_CODE
    : STANDARD_QUOTE_DEFAULT_CODE;
  const fallbackAst = await getStandardTemplateAst(knexOrTrx, fallbackCode);

  if (!fallbackAst) {
    throw new Error('Standard quote template fallback is unavailable');
  }

  return {
    templateAst: fallbackAst,
    source: 'standard-fallback',
    standardCode: fallbackCode,
  };
}
