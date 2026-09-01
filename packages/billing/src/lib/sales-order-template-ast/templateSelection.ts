import type { Knex } from 'knex';
import type { TemplateAst } from '@alga-psa/types';

import {
  resolveDocumentTemplate,
  type DocumentTemplateRef,
  type DocumentTemplateSource,
} from '../document-templates/resolution';
import { getDocumentTypeRegistryEntry, getDocumentTypeStandardAst, type DocumentType } from '../document-templates/registry';
import {
  fetchClientOverrideTemplate,
  fetchTenantDefaultTemplate,
} from '../document-templates/storage';

export interface ResolveSalesOrderTemplateResult {
  ast: TemplateAst;
  source: DocumentTemplateSource;
  code: string | null;
  /** Provenance of the winning template: custom uuid or standard code. */
  templateId: string | null;
  templateVersion: number | null;
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
  const standardCode = getDocumentTypeRegistryEntry(documentType).defaultStandardCode;
  const { value, source } = await resolveDocumentTemplate<DocumentTemplateRef>({
    fetchOverride: () =>
      opts?.clientId
        ? fetchClientOverrideTemplate(knex, tenant, documentType, opts.clientId)
        : Promise.resolve(null),
    fetchTenantDefault: () => fetchTenantDefaultTemplate(knex, tenant, documentType),
    getStandard: () => ({ ast: getDocumentTypeStandardAst(documentType), templateId: standardCode, version: null }),
  });

  return {
    ast: value.ast,
    source,
    code: source === 'standard' ? standardCode : null,
    templateId: value.templateId,
    templateVersion: value.version,
  };
}
