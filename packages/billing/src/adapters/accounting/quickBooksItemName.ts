/**
 * The QuickBooks item a quickbooks_csv service/discount mapping names. Shared by
 * the QuickBooks CSV and QuickBooks Desktop (IIF) exporters, which both use
 * these mappings.
 */
export function getQuickBooksItemName(mapping: {
  external_entity_id: string;
  metadata?: Record<string, any> | null;
}): string {
  const metadata = mapping.metadata;
  if (metadata) {
    if (typeof metadata.name === 'string') return metadata.name;
    if (typeof metadata.display_name === 'string') return metadata.display_name;
    if (typeof metadata.item_name === 'string') return metadata.item_name;
  }
  return mapping.external_entity_id;
}
