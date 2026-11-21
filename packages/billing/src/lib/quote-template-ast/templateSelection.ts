import type { TemplateAst, IQuote } from '@alga-psa/types';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import Quote from '../../models/quote';
import {
  STANDARD_QUOTE_DEFAULT_CODE,
  getStandardQuoteTemplateAstByCode,
} from './standardTemplates';

const cloneAst = (ast: TemplateAst): TemplateAst =>
  JSON.parse(JSON.stringify(ast)) as TemplateAst;

const standardQuoteTemplates = (knexOrTrx: Knex | Knex.Transaction) =>
  tenantDb(knexOrTrx, '__standard_quote_template_ast_catalog__').table('standard_quote_document_templates');

const getCustomTemplateAst = async (
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  templateId: string
): Promise<TemplateAst | null> => {
  const record = await tenantDb(knexOrTrx, tenant).table('quote_document_templates')
    .select('templateAst')
    .where({ template_id: templateId })
    .first<{ templateAst?: TemplateAst | null }>();

  return record?.templateAst ? cloneAst(record.templateAst) : null;
};

const getStandardTemplateAst = async (
  knexOrTrx: Knex | Knex.Transaction,
  code: string
): Promise<TemplateAst | null> => {
  const record = await standardQuoteTemplates(knexOrTrx)
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
  const record = await standardQuoteTemplates(knexOrTrx)
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

  const tenantAssignment = await tenantDb(knexOrTrx, tenant).table('quote_document_template_assignments')
    .select('template_source', 'standard_quote_document_template_code', 'quote_document_template_id')
    .where({ scope_type: 'tenant' })
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
    const standardCode = tenantAssignment.standard_quote_document_template_code;
    const standardAst = await getStandardTemplateAst(knexOrTrx, standardCode);

    if (standardAst) {
      return {
        templateAst: standardAst,
        source: 'tenant-default',
        standardCode,
      };
    }
  }

  // The grouped-by-location standard is only ever used when someone picks it —
  // per quote or as the tenant assignment. How many locations the items span
  // never changes the layout, so the fallback is always the flat default.
  const fallbackAst = await getStandardTemplateAst(knexOrTrx, STANDARD_QUOTE_DEFAULT_CODE);

  if (!fallbackAst) {
    throw new Error('Standard quote template fallback is unavailable');
  }

  return {
    templateAst: fallbackAst,
    source: 'standard-fallback',
    standardCode: STANDARD_QUOTE_DEFAULT_CODE,
  };
}
