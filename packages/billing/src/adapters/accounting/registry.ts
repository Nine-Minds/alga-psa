import { AccountingExportAdapter } from '@alga-psa/types';
import { QuickBooksOnlineAdapter } from './quickBooksOnlineAdapter';
import { QuickBooksDesktopAdapter } from './quickBooksDesktopAdapter';
import { QuickBooksCSVAdapter } from './quickBooksCSVAdapter';
import { XeroAdapter } from './xeroAdapter';
import { XeroCsvAdapter } from './xeroCsvAdapter';

export const ADAPTER_EXPORT_CAPABILITIES = {
  quickbooks_online: ['invoice', 'vendor_bill'],
  quickbooks_desktop: ['invoice'],
  quickbooks_csv: ['invoice'],
  xero: ['invoice'],
  xero_csv: ['invoice']
} as const satisfies Record<string, readonly string[]>;

/**
 * Outbound remote-operation support per adapter, for producers that enqueue
 * work at the billing-event boundary. Mirrors the adapter capabilities; the
 * appliers remain the authoritative capability gate.
 */
export const ADAPTER_OUTBOUND_CAPABILITIES = {
  quickbooks_online: { payment: true, credit: true, void: true },
  quickbooks_desktop: { payment: false, credit: false, void: false },
  quickbooks_csv: { payment: false, credit: false, void: false },
  xero: { payment: false, credit: false, void: false },
  xero_csv: { payment: false, credit: false, void: false }
} as const satisfies Record<string, { payment: boolean; credit: boolean; void: boolean }>;

export function adapterSupportsOutboundOperation(
  adapterType: string,
  operation: 'payment' | 'credit' | 'void'
): boolean {
  const caps = ADAPTER_OUTBOUND_CAPABILITIES as Record<string, { payment: boolean; credit: boolean; void: boolean } | undefined>;
  return Boolean(caps[adapterType]?.[operation]);
}

export class AccountingAdapterRegistry {
  private readonly adapters = new Map<string, AccountingExportAdapter>();

  constructor(initialAdapters: AccountingExportAdapter[] = []) {
    initialAdapters.forEach((adapter) => this.register(adapter));
  }

  register(adapter: AccountingExportAdapter) {
    this.adapters.set(adapter.type, adapter);
  }

  get(adapterType: string): AccountingExportAdapter | undefined {
    return this.adapters.get(adapterType);
  }

  list(): string[] {
    return Array.from(this.adapters.keys());
  }

  static async createDefault(): Promise<AccountingAdapterRegistry> {
    const adapters = await Promise.all([
      QuickBooksOnlineAdapter.create(),
      QuickBooksDesktopAdapter.create(),
      QuickBooksCSVAdapter.create(),
      XeroAdapter.create(),
      XeroCsvAdapter.create()
    ]);
    return new AccountingAdapterRegistry(adapters);
  }
}
