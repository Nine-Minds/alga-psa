import type { TemplateAst, IQuote } from '@alga-psa/types';
import type { Knex } from 'knex';

import Quote from '../../models/quote';
import { getStandardQuoteTemplateAstByCode } from './standardTemplates';

const cloneAst = (ast: TemplateAst): TemplateAst =>
  JSON.parse(JSON.stringify(ast)) as TemplateAst;

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

  const fallbackCode = 'standard-quote-default';
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
