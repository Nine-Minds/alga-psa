import type { DesignerNode } from '../state/designerStore';
import { getNodeMetadata } from './nodeProps';

export type DesignerDocumentKind = 'invoice' | 'quote' | 'sales-order';

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

export const resolveDesignerDocumentKind = (nodes: DesignerNode[]): DesignerDocumentKind => {
  const documentNode =
    nodes.find((node) => node.type === 'document' && node.parentId === null) ??
    nodes.find((node) => node.type === 'document');
  if (!documentNode) {
    return 'invoice';
  }

  const metadata = getNodeMetadata(documentNode) as Record<string, unknown>;
  // Sales order is checked before quote — both expose tenant/customer bindings, so the
  // sales-order-specific bindings must win.
  if (hasSalesOrderBindingCatalog(metadata.__astBindingCatalog)) {
    return 'sales-order';
  }
  if (hasQuoteBindingCatalog(metadata.__astBindingCatalog)) {
    return 'quote';
  }

  const templateMetadata = metadata.__astTemplateMetadata;
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
