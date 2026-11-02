import type { TemplateAst } from '@alga-psa/types';

import type { TemplatePrintGeometry } from '../invoice-template-ast/printSettings';

import { buildSalesOrderTemplateBindings } from '../sales-order-template-ast/bindings';
import { buildSampleSalesOrderViewModel } from '../sales-order-template-ast/sampleData';
import {
  STANDARD_SALES_ORDER_CONFIRMATION_CODE,
  STANDARD_SALES_ORDER_TEMPLATE_ASTS,
  getStandardSalesOrderTemplateAstByCode,
} from '../sales-order-template-ast/standardTemplates';
import {
  STANDARD_PACKING_SLIP_CODE,
  STANDARD_PACKING_SLIP_TEMPLATE_ASTS,
  STANDARD_PICK_LIST_CODE,
  STANDARD_PICK_LIST_TEMPLATE_ASTS,
  getStandardPackingSlipTemplateAstByCode,
  getStandardPickListTemplateAstByCode,
} from '../sales-order-template-ast/otherDocuments';
import { buildStagingManifestTemplateBindings } from '../staging-manifest-template-ast/bindings';
import { buildSampleStagingManifestViewModel } from '../staging-manifest-template-ast/sampleData';
import {
  STANDARD_STAGING_MANIFEST_CODE,
  STANDARD_STAGING_MANIFEST_TEMPLATE_ASTS,
  getStandardStagingManifestTemplateAstByCode,
} from '../staging-manifest-template-ast/standardTemplates';
import { buildRmaReturnSlipTemplateBindings } from '../rma-return-slip-template-ast/bindings';
import { buildSampleRmaReturnSlipViewModel } from '../rma-return-slip-template-ast/sampleData';
import {
  STANDARD_RMA_RETURN_SLIP_CODE,
  STANDARD_RMA_RETURN_SLIP_TEMPLATE_ASTS,
  getStandardRmaReturnSlipTemplateAstByCode,
} from '../rma-return-slip-template-ast/standardTemplates';
import { buildLabelTemplateBindings } from '../label-template-ast/bindings';
import { buildSampleLabelViewModel } from '../label-template-ast/sampleData';
import {
  STANDARD_LABEL_TEMPLATE_ASTS,
  STANDARD_LABEL_TICKET_WORK_TAG_CODE,
  getStandardLabelTemplateAstByCode,
} from '../label-template-ast/standardTemplates';

/**
 * The generic document-template registry (Approach C). Each registered document type contributes
 * its per-type artifacts — label, standard template catalog, and binding catalog — so the generic
 * storage, resolution, and (Phase 2) designer/management layers stay document-type agnostic and a
 * new type is "register an entry" rather than "copy the whole stack".
 *
 * Sales Order is the first registered type. Invoice and quote keep their existing dedicated stacks
 * for now; the registry is shaped so they could migrate onto it later.
 */
export type DocumentType = 'sales-order' | 'packing-slip' | 'pick-list' | 'work-tag' | 'staging-manifest' | 'rma-return-slip';

export interface DocumentTypeRegistryEntry {
  /** Human label for menus / the management route. */
  label: string;
  /** The default standard template code for this type. */
  defaultStandardCode: string;
  /** All built-in standard template codes for this type. */
  standardCodes: string[];
  /** Resolve a standard template AST by code (clone). */
  getStandardTemplateAstByCode: (code: string) => TemplateAst | null;
  /** The binding catalog the designer exposes for this type. */
  buildBindings: () => NonNullable<TemplateAst['bindings']>;
  /** A representative render model for designer preview (rendered against the template). */
  buildSampleViewModel: () => Record<string, unknown>;
  /** The print path this type reaches paper through; the designer preview frames content to match it. */
  printGeometry: TemplatePrintGeometry;
}

export const DOCUMENT_TYPE_REGISTRY: Record<DocumentType, DocumentTypeRegistryEntry> = {
  'sales-order': {
    label: 'Sales Order',
    defaultStandardCode: STANDARD_SALES_ORDER_CONFIRMATION_CODE,
    standardCodes: Object.keys(STANDARD_SALES_ORDER_TEMPLATE_ASTS),
    getStandardTemplateAstByCode: getStandardSalesOrderTemplateAstByCode,
    buildBindings: buildSalesOrderTemplateBindings,
    buildSampleViewModel: () => buildSampleSalesOrderViewModel() as unknown as Record<string, unknown>,
    printGeometry: 'document',
  },
  // Packing slip + pick list render from the SAME Sales Order data, so they reuse the SO bindings +
  // sample; only their standard templates differ. Adding a document type is "register an entry".
  'packing-slip': {
    label: 'Packing Slip',
    defaultStandardCode: STANDARD_PACKING_SLIP_CODE,
    standardCodes: Object.keys(STANDARD_PACKING_SLIP_TEMPLATE_ASTS),
    getStandardTemplateAstByCode: getStandardPackingSlipTemplateAstByCode,
    buildBindings: buildSalesOrderTemplateBindings,
    buildSampleViewModel: () => buildSampleSalesOrderViewModel() as unknown as Record<string, unknown>,
    printGeometry: 'document',
  },
  'pick-list': {
    label: 'Pick List',
    defaultStandardCode: STANDARD_PICK_LIST_CODE,
    standardCodes: Object.keys(STANDARD_PICK_LIST_TEMPLATE_ASTS),
    getStandardTemplateAstByCode: getStandardPickListTemplateAstByCode,
    buildBindings: buildSalesOrderTemplateBindings,
    buildSampleViewModel: () => buildSampleSalesOrderViewModel() as unknown as Record<string, unknown>,
    printGeometry: 'document',
  },
  // ONE generic label type (decision for alga-2026-0002683 PLAN.md question 3): every label class
  // (ticket work tag, asset label, stock-unit label) renders from the uniform LabelViewModel, with
  // one standard template per class. Tenants manage one template list, not one per entity.
  'work-tag': {
    label: 'Work Tag / Label',
    defaultStandardCode: STANDARD_LABEL_TICKET_WORK_TAG_CODE,
    standardCodes: Object.keys(STANDARD_LABEL_TEMPLATE_ASTS),
    getStandardTemplateAstByCode: getStandardLabelTemplateAstByCode,
    buildBindings: buildLabelTemplateBindings,
    buildSampleViewModel: () => buildSampleLabelViewModel() as unknown as Record<string, unknown>,
    // Printed by the label batch path: one clipped cell per label, never the single-document PDF path.
    printGeometry: 'label-cell',
  },
  // What is in one project staging box (alga-2026-0002683 C6). Rendered on demand and never filed.
  'staging-manifest': {
    label: 'Packing Manifest',
    defaultStandardCode: STANDARD_STAGING_MANIFEST_CODE,
    standardCodes: Object.keys(STANDARD_STAGING_MANIFEST_TEMPLATE_ASTS),
    getStandardTemplateAstByCode: getStandardStagingManifestTemplateAstByCode,
    buildBindings: buildStagingManifestTemplateBindings,
    buildSampleViewModel: () => buildSampleStagingManifestViewModel() as unknown as Record<string, unknown>,
    printGeometry: 'document',
  },
  // The paper that travels with a client device returned to a vendor (alga-2026-0002683 C5). Rendered on
  // demand from the RMA and never filed.
  'rma-return-slip': {
    label: 'RMA Return Slip',
    defaultStandardCode: STANDARD_RMA_RETURN_SLIP_CODE,
    standardCodes: Object.keys(STANDARD_RMA_RETURN_SLIP_TEMPLATE_ASTS),
    getStandardTemplateAstByCode: getStandardRmaReturnSlipTemplateAstByCode,
    buildBindings: buildRmaReturnSlipTemplateBindings,
    buildSampleViewModel: () => buildSampleRmaReturnSlipViewModel() as unknown as Record<string, unknown>,
    printGeometry: 'document',
  },
};

export const DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_REGISTRY) as DocumentType[];

export function isDocumentType(value: string): value is DocumentType {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_TYPE_REGISTRY, value);
}

export function getDocumentTypeRegistryEntry(type: DocumentType): DocumentTypeRegistryEntry {
  const entry = DOCUMENT_TYPE_REGISTRY[type];
  if (!entry) {
    throw new Error(`Unknown document type: ${type}`);
  }
  return entry;
}

/** The built-in standard template for a type — the resolver's getStandard() backstop. */
export function getDocumentTypeStandardAst(type: DocumentType): TemplateAst {
  const entry = getDocumentTypeRegistryEntry(type);
  const ast = entry.getStandardTemplateAstByCode(entry.defaultStandardCode);
  if (!ast) {
    throw new Error(`No standard template for document type: ${type}`);
  }
  return ast;
}
