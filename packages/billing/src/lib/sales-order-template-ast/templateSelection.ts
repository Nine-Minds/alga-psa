import type { TemplateAst } from '@alga-psa/types';

import {
  getStandardSalesOrderTemplateAstByCode,
  STANDARD_SALES_ORDER_CONFIRMATION_CODE,
} from './standardTemplates';

export interface ResolveSalesOrderTemplateResult {
  ast: TemplateAst;
  source: 'standard-fallback' | 'tenant-default' | 'sales-order';
  code: string | null;
}

/**
 * Phase 1: always resolves to the code-defined standard confirmation template.
 * Phase 2 replaces this with registry/assignment-backed resolution
 * (sales-order-level override → tenant default → standard fallback).
 */
export function resolveSalesOrderTemplateAst(): ResolveSalesOrderTemplateResult {
  const ast = getStandardSalesOrderTemplateAstByCode(STANDARD_SALES_ORDER_CONFIRMATION_CODE);
  if (!ast) {
    throw new Error('Standard sales order confirmation template not found');
  }
  return { ast, source: 'standard-fallback', code: STANDARD_SALES_ORDER_CONFIRMATION_CODE };
}
