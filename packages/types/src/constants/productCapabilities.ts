import { resolveProductCode, type ProductCode } from './productCodes';

// Product permissions only narrow access. RBAC, tenant scope, tier, add-ons, and
// sponsorship/licensing must still authorize the operation independently.
export const PRODUCT_CAPABILITIES = {
  psa: ['*'],
  algadesk: [
    'dashboard', 'tickets', 'clients', 'contacts', 'knowledge_base', 'reports',
    'settings', 'client_portal', 'email_to_ticket',
  ],
  co_managed: [
    'dashboard', 'tickets', 'clients', 'contacts', 'knowledge_base', 'reports',
    'settings', 'client_portal', 'email_to_ticket', 'documents', 'credentials',
    'projects', 'scheduling', 'time_entry', 'operational_time', 'assets', 'sla', 'workflows',
    'directory_connections',
  ],
} as const satisfies Record<ProductCode, readonly string[]>;

export type ProductCapability =
  | Exclude<(typeof PRODUCT_CAPABILITIES)[ProductCode][number], '*'>
  | 'billing' | 'sales' | 'accounting' | 'rmm' | 'extensions' | 'surveys'
  | 'co_management_sponsorship';

export function productHasCapability(
  productCode: string | null | undefined,
  capability: ProductCapability,
): boolean {
  const resolved = resolveProductCode(productCode);
  if (resolved.isMisconfigured) return false;
  const capabilities: readonly string[] = PRODUCT_CAPABILITIES[resolved.productCode];
  return capabilities.includes('*') || capabilities.includes(capability);
}

export type TimeEntryBillingMode = 'commercial' | 'operational';

/** Operational effort is an explicit product capability; commercial PSA time
 * retains service/contract semantics even when an individual entry is unbillable. */
export function productTimeEntryMode(productCode: string | null | undefined): TimeEntryBillingMode | null {
  if (!productHasCapability(productCode, 'time_entry')) return null;
  if (productHasCapability(productCode, 'billing')) return 'commercial';
  return productHasCapability(productCode, 'operational_time') ? 'operational' : null;
}
