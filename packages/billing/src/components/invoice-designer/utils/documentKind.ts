import type { DesignerNode } from '../state/designerStore';
import { getNodeMetadata } from './nodeProps';

export type DesignerDocumentKind = 'invoice' | 'quote';

const hasQuoteBindingCatalog = (bindings: unknown): boolean => {
  if (!bindings || typeof bindings !== 'object') {
    return false;
  }

  const values = (bindings as { values?: Record<string, unknown> }).values;
  const collections = (bindings as { collections?: Record<string, unknown> }).collections;
  return Boolean(
    (values &&
      typeof values === 'object' &&
      ('quoteNumber' in values || 'recurringTotal' in values || 'clientName' in values)) ||
      (collections &&
        typeof collections === 'object' &&
        ('lineItems' in collections || 'recurringItems' in collections || 'serviceItems' in collections))
  );
};

export const resolveDesignerDocumentKind = (nodes: DesignerNode[]): DesignerDocumentKind => {
  const documentNode =
    nodes.find((node) => node.type === 'document' && node.parentId === null) ??
    nodes.find((node) => node.type === 'document');
  if (!documentNode) {
    return 'invoice';
  }

  const metadata = getNodeMetadata(documentNode) as Record<string, unknown>;
  if (hasQuoteBindingCatalog(metadata.__astBindingCatalog)) {
    return 'quote';
  }

  const templateMetadata = metadata.__astTemplateMetadata;
  if (templateMetadata && typeof templateMetadata === 'object') {
    const templateName = String((templateMetadata as { templateName?: unknown }).templateName ?? '').toLowerCase();
    if (templateName.includes('quote')) {
      return 'quote';
    }
  }

  return 'invoice';
};
