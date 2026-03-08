import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../src/components/billing-dashboard/ManualInvoices.tsx'),
    'utf8'
  );
}

describe('manual invoices client creation wiring contract', () => {
  it('T025: ManualInvoices keeps add-new client wired to QuickAddClient and auto-selects it', () => {
    const source = readSource();

    expect(source).toContain('onAddNew={() => setIsQuickAddClientOpen(true)}');
    expect(source).toContain('open={isQuickAddClientOpen}');
    expect(source).toContain('setClientOptions((prevClients) => {');
    expect(source).toContain('setSelectedClient(newClient.client_id);');
  });
});
