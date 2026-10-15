/**
 * Integration type whose tenant_external_entity_mappings an adapter reads.
 * QuickBooks Desktop (IIF) shares the QuickBooks CSV mappings; validation and
 * the adapter must agree, or a batch validates against mappings it never uses.
 */
export function resolveMappingAdapterType(adapterType: string): string {
  return adapterType === 'quickbooks_desktop' ? 'quickbooks_csv' : adapterType;
}
