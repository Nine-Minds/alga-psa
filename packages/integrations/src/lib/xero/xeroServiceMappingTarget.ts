/**
 * Explicit target kind for a Xero service mapping.
 *
 * A Xero invoice line can reference the catalog two ways: `ItemCode` naming a
 * Products & Services item, or `AccountCode` naming a revenue account with the
 * item omitted entirely. An Item Code and an Account Code can hold the exact
 * same string (support case alga0002321: Item catalog empty, revenue account
 * "200"), so the kind must be stored explicitly — it can never be inferred
 * from the shape or value of the stored code.
 *
 * The kind is persisted on the mapping row as `metadata.xeroTargetKind`.
 * Legacy mappings created before account mode existed have no kind and are
 * treated as item mappings — that was the only semantics the exporter ever
 * gave them. A legacy code that no longer resolves to an Item is invalid and
 * requires an explicit user choice; it must never silently become an account
 * mapping just because a same-code account exists.
 */
export type XeroServiceTargetKind = 'item' | 'account';

export const XERO_TARGET_KIND_METADATA_KEY = 'xeroTargetKind';

/**
 * Account types eligible for account-code-only ACCREC invoice lines. Xero
 * classifies revenue accounts as REVENUE, SALES, or OTHERINCOME depending on
 * the organisation's chart of accounts; all three are the revenue class Xero
 * accepts on sales invoice lines. Bank/system/liability accounts are excluded
 * deliberately — Xero rejects or misclassifies them on ACCREC lines.
 */
export const XERO_SALES_ACCOUNT_TYPES = new Set(['REVENUE', 'SALES', 'OTHERINCOME']);

/**
 * Read the explicit target kind off mapping metadata. Absent metadata or an
 * absent key means a legacy mapping: item mode, unconditionally.
 *
 * Returns null for a present-but-unrecognised value so callers can fail
 * closed instead of silently treating garbage as item mode.
 */
export function readXeroServiceTargetKind(
  metadata: Record<string, unknown> | null | undefined
): XeroServiceTargetKind | null {
  const raw = metadata?.[XERO_TARGET_KIND_METADATA_KEY];
  if (raw === undefined || raw === null || raw === 'item') {
    return 'item';
  }
  if (raw === 'account') {
    return 'account';
  }
  return null;
}
