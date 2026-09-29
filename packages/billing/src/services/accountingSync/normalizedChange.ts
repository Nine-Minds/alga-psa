import type {
  AccountingExportAdapter,
  NormalizedExternalDocumentPayload,
  NormalizedExternalPaymentPayload
} from '@alga-psa/types';

/**
 * Guards + helpers that let the shared reconciliation appliers consume a
 * provider-neutral change payload. Adapters normalize at their boundary; the
 * appliers prefer `change.normalized` and only fall back to the legacy QBO
 * payload when it is absent (historical mapping/metadata compatibility).
 */

export function isNormalizedPaymentPayload(
  payload: unknown
): payload is NormalizedExternalPaymentPayload {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      Array.isArray((payload as NormalizedExternalPaymentPayload).allocations) &&
      typeof (payload as NormalizedExternalPaymentPayload).isCreditApplication === 'boolean'
  );
}

export function isNormalizedDocumentPayload(
  payload: unknown
): payload is NormalizedExternalDocumentPayload {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      'isVoided' in (payload as Record<string, unknown>) &&
      'totalAmount' in (payload as Record<string, unknown>) &&
      !('allocations' in (payload as Record<string, unknown>))
  );
}

/**
 * Map an adapter type to the provider identifier recorded on AR rows.
 * `invoice_payments.payment_method` and transaction metadata use these
 * identifiers to tell a provider-synced payment from a native/Stripe one.
 */
export function providerForAdapterType(adapterType: string): string {
  switch (adapterType) {
    case 'quickbooks_online':
    case 'quickbooks_desktop':
      return 'quickbooks';
    case 'xero':
      return 'xero';
    default:
      return adapterType;
  }
}

export type OutboundOperation = 'payment' | 'credit' | 'void';

/**
 * Whether an adapter may attempt an outbound remote operation. When no adapter
 * is supplied (unit tests / legacy callers) QBO semantics are preserved.
 */
export function adapterSupportsOutbound(
  adapter: AccountingExportAdapter | undefined,
  adapterType: string,
  operation: OutboundOperation
): boolean {
  const caps = adapter?.capabilities();
  if (caps) {
    const flag =
      operation === 'payment'
        ? caps.supportsOutboundPayment
        : operation === 'credit'
          ? caps.supportsOutboundCredit
          : caps.supportsOutboundVoid;
    if (flag !== undefined) {
      return flag;
    }
  }

  // No adapter or no explicit flag: only the QBO adapter historically had
  // outbound remote writes, so preserve that behavior and gate everything else.
  return adapterType === 'quickbooks_online';
}
