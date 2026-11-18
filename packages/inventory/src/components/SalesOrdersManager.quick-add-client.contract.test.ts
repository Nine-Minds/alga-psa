/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return fs.readFileSync(path.resolve(__dirname, './SalesOrdersManager.tsx'), 'utf8');
}

describe('sales orders client creation wiring contract', () => {
  it('selects the created client through currency and kit repricing', () => {
    const source = readSource();

    // The picker searches on the server: no client list is held, and the picked client's currency is read by id.
    expect(source).not.toContain('setClientOptions');
    expect(source).not.toContain('clients={clientOptions}');
    expect(source).toContain('getInventoryClientCurrency(clientId)');
    expect(source).toContain('onAddNew={() => setIsQuickAddClientOpen(true)}');
    expect(source).toContain('open: isQuickAddClientOpen,');
    expect(source).toContain('onOpenChange: setIsQuickAddClientOpen,');
    expect(source).toContain('onClientSelect(newClient.client_id, newClient);');
    expect(source).toContain("createdClient?.default_currency_code || (clientId ? defaultCurrencyCode : '')");
    expect(source).toContain('lines: f.lines.map((line) => {');
    expect(source).toContain('service?.kit_currency && service.kit_currency.toUpperCase() !== nextCurrency.toUpperCase()');
    expect(source).toContain('skipSuccessDialog: true,');
  });
});
