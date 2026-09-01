/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return fs.readFileSync(path.resolve(__dirname, './SalesOrdersManager.tsx'), 'utf8');
}

describe('sales orders client creation wiring contract', () => {
  it('upserts a local option and selects it through currency and kit repricing', () => {
    const source = readSource();

    expect(source).toContain('const [clientOptions, setClientOptions] = useState<IClient[]>(clients);');
    expect(source).toContain('clients={clientOptions}');
    expect(source).toContain('onAddNew={() => setIsQuickAddClientOpen(true)}');
    expect(source).toContain('open: isQuickAddClientOpen,');
    expect(source).toContain('onOpenChange: setIsQuickAddClientOpen,');
    expect(source).toContain(
      '(client) => client.client_id === newClient.client_id,',
    );
    expect(source).toContain('nextClients[existingIndex] = newClient;');
    expect(source).toContain('onClientSelect(newClient.client_id, newClient);');
    expect(source).toContain("const nextCurrency = picked?.default_currency_code || (clientId ? defaultCurrencyCode : '');");
    expect(source).toContain('lines: f.lines.map((line) => {');
    expect(source).toContain('service?.kit_currency && service.kit_currency.toUpperCase() !== nextCurrency.toUpperCase()');
    expect(source).toContain('skipSuccessDialog: true,');
  });
});
