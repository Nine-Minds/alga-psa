import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const contractWizardIntegrationSource = readFileSync(
  resolve(__dirname, '../../integration/contractWizard.integration.test.ts'),
  'utf8'
);

const contractPurchaseOrderIntegrationSource = readFileSync(
  resolve(__dirname, '../../integration/billing/contractPurchaseOrderSupport.integration.test.ts'),
  'utf8'
);

describe('multi-active legacy test assignment assumptions', () => {
  it('T051: targeted integration tests assert explicit assignment identity instead of client_id first-row lookups', () => {
    expect(contractWizardIntegrationSource).toContain(
      ".where({ tenant: tenantId, client_id: clientId, contract_id: result.contract_id })"
    );
    expect(contractWizardIntegrationSource).not.toContain(
      ".where({ tenant: tenantId, client_id: clientId })\n      .first();"
    );

    expect(contractPurchaseOrderIntegrationSource).toContain('const wizardResult = await createClientContractFromWizard({');
    expect(contractPurchaseOrderIntegrationSource).toContain(
      ".where({ tenant: tenantId, client_id: clientId, contract_id: wizardResult.contract_id })"
    );
    expect(contractPurchaseOrderIntegrationSource).not.toContain(".orderBy('created_at', 'desc')");
  });
});
