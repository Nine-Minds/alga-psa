import type { DesignerNode } from '../state/designerStore';
import { getNodeMetadata } from './nodeProps';

export type DesignerDocumentKind = 'invoice' | 'quote' | 'sales-order' | 'work-tag' | 'staging-manifest' | 'rma-return-slip';

// recordUrl + identifier are the label view model's discriminators. Label catalogs also expose
// clientName / tenantName, which the quote check below would otherwise claim, so this runs first.
const hasWorkTagBindingCatalog = (bindings: unknown): boolean => {
  if (!bindings || typeof bindings !== 'object') {
    return false;
  }
  const values = (bindings as { values?: Record<string, unknown> }).values;
  return Boolean(values && typeof values === 'object' && 'recordUrl' in values && 'identifier' in values);
};

// boxIdentifier is the packing manifest's discriminator (C6); it also carries recordUrl, so it is
// checked before the label catalog check, which needs `identifier` and would not match anyway.
const hasStagingManifestBindingCatalog = (bindings: unknown): boolean => {
  if (!bindings || typeof bindings !== 'object') {
    return false;
  }
  const values = (bindings as { values?: Record<string, unknown> }).values;
  return Boolean(values && typeof values === 'object' && 'boxIdentifier' in values);
};

// rmaNumber is the RMA return slip's discriminator (C5); it also carries recordUrl, so it runs before the label check.
const hasRmaReturnSlipBindingCatalog = (bindings: unknown): boolean => {
  if (!bindings || typeof bindings !== 'object') {
    return false;
  }
  const values = (bindings as { values?: Record<string, unknown> }).values;
  return Boolean(values && typeof values === 'object' && 'rmaNumber' in values);
};

const hasSalesOrderBindingCatalog = (bindings: unknown): boolean => {
  if (!bindings || typeof bindings !== 'object') {
    return false;
  }
  const values = (bindings as { values?: Record<string, unknown> }).values;
  // orderNumber / expectedShipDate are sales-order-specific (invoices and quotes have neither).
  return Boolean(
    values && typeof values === 'object' && ('orderNumber' in values || 'expectedShipDate' in values),
  );
};

const hasQuoteBindingCatalog = (bindings: unknown): boolean => {
  if (!bindings || typeof bindings !== 'object') {
    return false;
  }

  const values = (bindings as { values?: Record<string, unknown> }).values;
  const collections = (bindings as { collections?: Record<string, unknown> }).collections;

  const hasQuoteSpecificValueBinding = Boolean(
    values &&
      typeof values === 'object' &&
      (
        'quoteNumber' in values ||
        'quoteDate' in values ||
        'validUntil' in values ||
        'clientName' in values ||
        'contactName' in values ||
        'tenantName' in values ||
        'discountTotal' in values ||
        'serviceSubtotal' in values ||
        'productSubtotal' in values
      )
  );

  const hasQuoteSpecificCollectionBinding = Boolean(
    collections &&
      typeof collections === 'object' &&
      (
        'phases' in collections ||
        'serviceItems' in collections ||
        'productItems' in collections
      )
  );

  return hasQuoteSpecificValueBinding || hasQuoteSpecificCollectionBinding;
};

/**
 * Classifies a template from its binding catalog — usable from both the designer store (via
 * `resolveDesignerDocumentKind`) and the AST import/export, which only has the raw AST.
 * Packing slips and pick lists reuse the sales-order catalog, so they classify as 'sales-order'.
 */
export const resolveDocumentKindFromBindingCatalog = (
  bindings: unknown,
  templateMetadata?: unknown
): DesignerDocumentKind => {
  if (hasStagingManifestBindingCatalog(bindings)) {
    return 'staging-manifest';
  }
  if (hasRmaReturnSlipBindingCatalog(bindings)) {
    return 'rma-return-slip';
  }
  if (hasWorkTagBindingCatalog(bindings)) {
    return 'work-tag';
  }
  // Sales order is checked before quote — both expose tenant/customer bindings, so the
  // sales-order-specific bindings must win.
  if (hasSalesOrderBindingCatalog(bindings)) {
    return 'sales-order';
  }
  if (hasQuoteBindingCatalog(bindings)) {
    return 'quote';
  }

  if (templateMetadata && typeof templateMetadata === 'object') {
    const templateName = String((templateMetadata as { templateName?: unknown }).templateName ?? '').toLowerCase();
    if (templateName.includes('sales order') || templateName.includes('order confirmation')) {
      return 'sales-order';
    }
    if (templateName.includes('quote')) {
      return 'quote';
    }
  }

  return 'invoice';
};

export const resolveDesignerDocumentKind = (nodes: DesignerNode[]): DesignerDocumentKind => {
  const documentNode =
    nodes.find((node) => node.type === 'document' && node.parentId === null) ??
    nodes.find((node) => node.type === 'document');
  if (!documentNode) {
    return 'invoice';
  }

  const metadata = getNodeMetadata(documentNode) as Record<string, unknown>;
  return resolveDocumentKindFromBindingCatalog(metadata.__astBindingCatalog, metadata.__astTemplateMetadata);
};
