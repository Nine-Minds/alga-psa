import type { TemplateAst } from '@alga-psa/types';

import {
  resolveDocumentTemplateAst,
  type DocumentTemplateSource,
} from '../document-templates/resolution';
import { getDocumentTypeStandardAst } from '../document-templates/registry';
import { STANDARD_SALES_ORDER_CONFIRMATION_CODE } from './standardTemplates';

export interface ResolveSalesOrderTemplateResult {
  ast: TemplateAst;
  source: DocumentTemplateSource;
  code: string | null;
}

/**
 * Resolve the template AST for a Sales Order document through the generic document-template
 * resolver (entity override → tenant default → standard).
 *
 * Phase 1: the override/tenant-default lookups are stubbed to null — there are no stored templates
 * yet — so this always lands on the registered standard confirmation. Phase 2 wires the lookups to
 * the document_template_assignments / document_templates tables.
 */
export async function resolveSalesOrderTemplateAst(): Promise<ResolveSalesOrderTemplateResult> {
  const { ast, source } = await resolveDocumentTemplateAst({
    fetchOverride: async () => null,
    fetchTenantDefault: async () => null,
    getStandard: () => getDocumentTypeStandardAst('sales-order'),
  });

  return {
    ast,
    source,
    code: source === 'standard' ? STANDARD_SALES_ORDER_CONFIRMATION_CODE : null,
  };
}
