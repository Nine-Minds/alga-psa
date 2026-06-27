import type { Knex } from 'knex';
import type { TemplateAst } from '@alga-psa/types';

import {
  resolveDocumentTemplateAst,
  type DocumentTemplateSource,
} from '../document-templates/resolution';
import { getDocumentTypeRegistryEntry, getDocumentTypeStandardAst, type DocumentType } from '../document-templates/registry';
import {
  fetchClientOverrideTemplateAst,
  fetchTenantDefaultTemplateAst,
} from '../document-templates/storage';

export interface ResolveSalesOrderTemplateResult {
  ast: TemplateAst;
  source: DocumentTemplateSource;
  code: string | null;
}

/**
 * Resolve the template AST for a Sales Order document of a given type (sales-order confirmation,
 * packing slip, or pick list — all rendered from the same SO data) through the generic resolver:
 * a client-scoped override wins, else the tenant default, else the type's registered standard.
 */
export async function resolveSalesOrderTemplateAst(
  knex: Knex | Knex.Transaction,
  tenant: string,
  documentType: DocumentType = 'sales-order',
  opts?: { clientId?: string | null },
): Promise<ResolveSalesOrderTemplateResult> {
  const { ast, source } = await resolveDocumentTemplateAst({
    fetchOverride: () =>
      opts?.clientId
        ? fetchClientOverrideTemplateAst(knex, tenant, documentType, opts.clientId)
        : Promise.resolve(null),
    fetchTenantDefault: () => fetchTenantDefaultTemplateAst(knex, tenant, documentType),
    getStandard: () => getDocumentTypeStandardAst(documentType),
  });

  return {
    ast,
    source,
    code: source === 'standard' ? getDocumentTypeRegistryEntry(documentType).defaultStandardCode : null,
  };
}
