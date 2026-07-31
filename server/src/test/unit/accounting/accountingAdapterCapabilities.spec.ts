import { describe, expect, it } from 'vitest';

import {
  AccountingAdapterRegistry,
  ADAPTER_EXPORT_CAPABILITIES
} from '../../../../../packages/billing/src/adapters/accounting/registry';
import { QuickBooksOnlineAdapter } from '../../../../../packages/billing/src/adapters/accounting/quickBooksOnlineAdapter';
import { QuickBooksDesktopAdapter } from '../../../../../packages/billing/src/adapters/accounting/quickBooksDesktopAdapter';
import { QuickBooksCSVAdapter } from '../../../../../packages/billing/src/adapters/accounting/quickBooksCSVAdapter';
import { XeroAdapter } from '../../../../../packages/billing/src/adapters/accounting/xeroAdapter';
import { XeroCsvAdapter } from '../../../../../packages/billing/src/adapters/accounting/xeroCsvAdapter';

describe('accounting adapter export capabilities', () => {
  it('keeps the lightweight registry capability map aligned with adapter declarations', async () => {
    const registry = new AccountingAdapterRegistry([
      await QuickBooksOnlineAdapter.create(),
      await QuickBooksDesktopAdapter.create(),
      await QuickBooksCSVAdapter.create(),
      await XeroAdapter.create(),
      await XeroCsvAdapter.create()
    ]);

    for (const adapterType of registry.list()) {
      const adapter = registry.get(adapterType);
      expect(adapter).toBeDefined();
      expect(ADAPTER_EXPORT_CAPABILITIES[adapterType as keyof typeof ADAPTER_EXPORT_CAPABILITIES]).toEqual(
        adapter!.capabilities().supportedExportTypes
      );
    }
  });
});
