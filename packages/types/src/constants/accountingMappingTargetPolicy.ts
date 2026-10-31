/**
 * Which external mapping targets several Alga entities may share.
 *
 * One pure policy consumed by the mapping actions, the bulk grid and the
 * suggestion engine. The partial unique index `idx_unique_external_mapping`
 * encodes the same decision in SQL (migrations freeze the literals instead of
 * importing this file); DB tests assert both representations agree.
 *
 * A target is "shareable" when many Alga entities may map to it, so it
 * reserves nothing. Everything not listed here is exclusive: one live mapping
 * per target.
 */

export const XERO_TARGET_KIND_KEY = 'xeroTargetKind';

/** QuickBooks Desktop posts to an account name; many entities share one. */
const QBD_SHARED_ENTITY_TYPES: ReadonlySet<string> = new Set(['service', 'discount', 'tax_code']);

/**
 * QuickBooks Online services, products and the automatic discount all export
 * as an ItemRef, so any number of them may route through one item. Customers,
 * invoices, payments, payment terms, categories and (deliberately, until an
 * ambiguous-tax import policy exists) tax codes stay exclusive.
 */
const QBO_SHARED_ENTITY_TYPES: ReadonlySet<string> = new Set(['service', 'discount']);

export function isSharedMappingTarget(
  integrationType: string,
  algaEntityType: string,
  targetMetadata?: Record<string, unknown> | null
): boolean {
  switch (integrationType) {
    case 'xero':
      return (targetMetadata?.[XERO_TARGET_KIND_KEY] ?? 'item') === 'account';
    case 'quickbooks_desktop':
      return QBD_SHARED_ENTITY_TYPES.has(algaEntityType);
    case 'quickbooks_online':
      return QBO_SHARED_ENTITY_TYPES.has(algaEntityType);
    default:
      return false;
  }
}
