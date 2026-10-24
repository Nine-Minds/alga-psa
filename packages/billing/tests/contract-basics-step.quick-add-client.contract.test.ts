import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../src/components/billing-dashboard/contracts/wizard-steps/ContractBasicsStep.tsx'),
    'utf8'
  );
}

describe('contract basics client creation wiring contract', () => {
  it('T024: ContractBasicsStep keeps add-new client wired to QuickAddClient and auto-selects it', () => {
    const source = readSource();

    expect(source).toContain('onAddNew={() => setIsQuickAddClientOpen(true)}');
    expect(source).toContain('open: isQuickAddClientOpen,');
    expect(source).toContain('primeSummaryClient(newClient);');
    expect(source).toContain('updateData({ client_id: newClient.client_id });');
    expect(source).toContain('const picked = await getClientByIdForBilling(id);');
    expect(source).toContain('if (picked.default_currency_code) updateData({ currency_code: picked.default_currency_code });');
    expect(source).toContain('skipSuccessDialog: true,');
  });
});
