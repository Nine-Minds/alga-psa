import type { Knex } from 'knex';
import type { TemplateAst } from '@alga-psa/types';

import {
  resolveDocumentTemplateAst,
  type DocumentTemplateSource,
} from '../document-templates/resolution';
import { getDocumentTypeStandardAst } from '../document-templates/registry';
import {
  fetchClientOverrideTemplateAst,
  fetchTenantDefaultTemplateAst,
} from '../document-templates/storage';
import { STANDARD_SALES_ORDER_CONFIRMATION_CODE } from './standardTemplates';

export interface ResolveSalesOrderTemplateResult {
  ast: TemplateAst;
  source: DocumentTemplateSource;
  code: string | null;
}

/**
 * Resolve the template AST for a Sales Order document through the generic resolver: a client-scoped
 * override wins, else the tenant default, else the registered standard confirmation. The lookups
 * query the generic document_template_assignments / document_templates tables; with no stored
 * assignments this lands on the standard.
 */
export async function resolveSalesOrderTemplateAst(
  knex: Knex | Knex.Transaction,
  tenant: string,
  opts?: { clientId?: string | null },
): Promise<ResolveSalesOrderTemplateResult> {
  const { ast, source } = await resolveDocumentTemplateAst({
    fetchOverride: () =>
      opts?.clientId
        ? fetchClientOverrideTemplateAst(knex, tenant, 'sales-order', opts.clientId)
        : Promise.resolve(null),
    fetchTenantDefault: () => fetchTenantDefaultTemplateAst(knex, tenant, 'sales-order'),
    getStandard: () => getDocumentTypeStandardAst('sales-order'),
  });

  return {
    ast,
    source,
    code: source === 'standard' ? STANDARD_SALES_ORDER_CONFIRMATION_CODE : null,
  };
}
