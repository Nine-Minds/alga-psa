import { AccountingExportAdapter } from './accountingExportAdapter';
import { QuickBooksOnlineAdapter } from './quickBooksOnlineAdapter';
import { QuickBooksDesktopAdapter } from './quickBooksDesktopAdapter';
import { XeroAdapter } from './xeroAdapter';

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
      XeroAdapter.create()
    ]);
    return new AccountingAdapterRegistry(adapters);
  }
}
